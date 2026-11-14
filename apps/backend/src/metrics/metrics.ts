import * as http from 'node:http';
import { Logger } from '@nestjs/common';
import {
  AggregatorRegistry,
  collectDefaultMetrics,
  Histogram,
  MetricObjectWithValues,
  MetricValue,
  register,
} from 'prom-client';

// prom-client default Node metrics (process CPU/mem, GC, event-loop lag).
collectDefaultMetrics();

// RED histogram — observed by HttpMetricsInterceptor on every HTTP request.
// The buckets above 5 s are for AI generation, which takes tens of seconds:
// without them its p95 could never read above 5 s.
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labelled by method/route/status',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120],
});

type Snapshot = MetricObjectWithValues<MetricValue<string>>[];

const PEER_TIMEOUT_MS = 2000;
export const PEER_RETRY_MS = 1000;

// The backend runs as BACKEND_PROCESSES pm2 cluster workers
// (ecosystem.config.cjs), each with its own registry. Port `port` is shared
// by the workers like 3000 is, so a scrape reaches one of them at random;
// each worker also serves its own registry as JSON on 127.0.0.1:port+1+n
// (NODE_APP_INSTANCE = n), and the one that took the scrape merges them all.
// Alloy keeps scraping app:9465 and sees the whole instance, as before.
// A worker that does not answer (restarting) is left out of that scrape.
export const metricsWorkers = () => ({
  count: Math.max(1, Number(process.env.BACKEND_PROCESSES) || 1),
  index: Number(process.env.NODE_APP_INSTANCE) || 0,
});

const peerPort = (port: number, index: number) => port + 1 + index;

const fetchSnapshot = (port: number) =>
  new Promise<Snapshot | undefined>((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/metrics.json', timeout: PEER_TIMEOUT_MS },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(body) : undefined);
          } catch {
            resolve(undefined);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
  });

// The text the scrape gets: this worker's registry alone with one worker,
// otherwise every worker's that answered, merged by prom-client's own rules
// (counters and histograms summed, gauges by their `aggregator`).
export async function instanceMetrics(port: number) {
  const { count, index } = metricsWorkers();
  if (count === 1) {
    return register.metrics();
  }
  const snapshots = await Promise.all(
    Array.from({ length: count }, (_, n) =>
      n === index
        ? (register.getMetricsAsJSON() as Promise<Snapshot>)
        : fetchSnapshot(peerPort(port, n))
    )
  );
  return AggregatorRegistry.aggregate(
    snapshots.filter((s): s is Snapshot => !!s)
  ).metrics();
}

// Serves /metrics on a DEDICATED internal port — deliberately NOT on the main
// Nest app (:3000), which sits behind the global Throttler (90 req/h → a 15s
// scrape would 429) and Policies auth guard. Bound to 0.0.0.0 = reachable only
// on the docker network, never published to host/ALB; Alloy scrapes
// app:<port>/metrics.
export function startMetricsServer(
  port = Number(process.env.METRICS_PORT) || 9465
): http.Server[] {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    try {
      res.setHeader('Content-Type', register.contentType);
      res.end(await instanceMetrics(port));
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : 'metrics error');
    }
  });
  // Metrics must never take the backend down: an 'error' event without a
  // listener is thrown and kills the process.
  server.on('error', (err) =>
    Logger.warn(`metrics server: ${err.message}`, 'Metrics')
  );
  server.listen(port, '0.0.0.0');

  const { count, index } = metricsWorkers();
  if (count === 1) {
    return [server];
  }
  // This worker's registry for the others, on loopback, on a port of its
  // own (exclusive: not handed round the cluster like the one above).
  const peer = http.createServer(async (req, res) => {
    if (req.url !== '/metrics.json') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    try {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await register.getMetricsAsJSON()));
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : 'metrics error');
    }
  });
  // `pm2 reload` starts the new worker under the same number while the old
  // one still holds this port. Unhandled, that EADDRINUSE killed every new
  // worker right after it started listening, and pm2 restarted it in a loop
  // until the old one was gone, with 502s behind nginx meanwhile. The new
  // worker takes the port once it is free.
  const listenPeer = () =>
    peer.listen({ port: peerPort(port, index), host: '127.0.0.1', exclusive: true });
  peer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      setTimeout(listenPeer, PEER_RETRY_MS).unref();
      return;
    }
    Logger.warn(`metrics peer server: ${err.message}`, 'Metrics');
  });
  listenPeer();
  return [server, peer];
}
