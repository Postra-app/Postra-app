import * as http from 'node:http';
import { collectDefaultMetrics, Histogram, register } from 'prom-client';

// prom-client default Node metrics (process CPU/mem, GC, event-loop lag).
collectDefaultMetrics();

// RED histogram — observed by HttpMetricsInterceptor on every HTTP request.
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, labelled by method/route/status',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});

// Serves /metrics on a DEDICATED internal port — deliberately NOT on the main
// Nest app (:3000), which sits behind the global Throttler (90 req/h → a 15s
// scrape would 429) and Policies auth guard. Bound to 0.0.0.0 = reachable only
// on the docker network, never published to host/ALB; Alloy scrapes
// app:<port>/metrics.
export function startMetricsServer(
  port = Number(process.env.METRICS_PORT) || 9465
): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    try {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : 'metrics error');
    }
  });

  server.listen(port, '0.0.0.0');
  return server;
}
