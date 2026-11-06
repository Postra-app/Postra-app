import type * as http from 'node:http';

// The backend runs as two pm2 cluster workers, each with its own prom-client
// registry. Alloy scrapes one port and gets whichever worker took the
// connection; that worker has to answer for the whole instance, or half of
// the requests vanish from the RED panels and every scrape tells a different
// story.
type MetricsModule = typeof import('./metrics');
type ColumnsModule = typeof import('@gitroom/nestjs-libraries/chat/mastra.columns.metric');

// A worker = its own copy of the modules, prom-client included.
const worker = () => {
  let metrics: MetricsModule | undefined;
  let columns: ColumnsModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    metrics = require('./metrics');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    columns = require('@gitroom/nestjs-libraries/chat/mastra.columns.metric');
  });
  return { metrics: metrics!, columns: columns! };
};

const asWorker = (index: number) => {
  process.env.BACKEND_PROCESSES = '2';
  process.env.NODE_APP_INSTANCE = String(index);
};

const value = (text: string, line: string) =>
  Number(
    text
      .split('\n')
      .find((l) => l.startsWith(line + ' '))
      ?.slice(line.length + 1)
  );

const COUNT =
  'http_request_duration_seconds_count{method="GET",route="/posts",status_code="200"}';

describe('backend /metrics with two workers', () => {
  const saved = { ...process.env };
  const servers: http.Server[] = [];
  // Not 9465: a backend running on this machine may hold it.
  const port = 39465 + Math.floor(Math.random() * 500) * 3;

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((s) => new Promise((r) => s.close(r)))
    );
    process.env = { ...saved };
  });

  it('the worker that takes the scrape answers for both', async () => {
    const first = worker();
    const second = worker();
    first.columns.registerMastraColumnsGauge(async () => [{ table: 'mastra_threads', columns: 7 }]);
    second.columns.registerMastraColumnsGauge(async () => [{ table: 'mastra_threads', columns: 7 }]);
    const labels = { method: 'GET', route: '/posts', status_code: '200' };
    for (let i = 0; i < 3; i++) first.metrics.httpRequestDuration.observe(labels, 0.02);
    for (let i = 0; i < 2; i++) second.metrics.httpRequestDuration.observe(labels, 0.02);

    asWorker(1);
    servers.push(...second.metrics.startMetricsServer(port));
    await new Promise((r) => setTimeout(r, 50));

    asWorker(0);
    const text = await first.metrics.instanceMetrics(port);
    // Requests are summed: 3 in one worker, 2 in the other.
    expect(value(text, COUNT)).toBe(5);
    // The same table seen by both is not counted twice.
    expect(value(text, 'postra_mastra_table_columns_max')).toBe(7);
  });

  it('a worker that does not answer is left out, not the whole scrape', async () => {
    const first = worker();
    first.metrics.httpRequestDuration.observe(
      { method: 'GET', route: '/posts', status_code: '200' },
      0.02
    );
    asWorker(0);
    // Nothing listens on the second worker's port (it is restarting).
    const text = await first.metrics.instanceMetrics(port);
    expect(value(text, COUNT)).toBe(1);
  });

  it('a reloaded worker waits for its predecessor to free the port instead of dying', async () => {
    // pm2 reload: the new worker gets the old one's number while the old
    // one still listens. An unhandled EADDRINUSE crashed the new worker
    // right after it started (a restart loop of 5 s of 502 behind nginx).
    const old = worker();
    const next = worker();
    asWorker(1);
    const [oldPublic, oldPeer] = old.metrics.startMetricsServer(port);
    servers.push(oldPublic);
    await new Promise((r) => setTimeout(r, 50));
    // Outside a cluster the shared public port clashes as well; that error
    // is logged and must not throw either.
    const [nextPublic, nextPeer] = next.metrics.startMetricsServer(port);
    servers.push(nextPublic);
    await new Promise((r) => setTimeout(r, 100));
    expect(nextPeer.listening).toBe(false);
    await new Promise((r) => oldPeer.close(r));
    await new Promise((r) => setTimeout(r, next.metrics.PEER_RETRY_MS + 300));
    expect(nextPeer.listening).toBe(true);
    servers.push(nextPeer);
  });

  it('a single process serves its own registry, as before', async () => {
    delete process.env.BACKEND_PROCESSES;
    delete process.env.NODE_APP_INSTANCE;
    const only = worker();
    only.metrics.httpRequestDuration.observe(
      { method: 'GET', route: '/posts', status_code: '200' },
      0.02
    );
    servers.push(...only.metrics.startMetricsServer(port));
    expect(servers).toHaveLength(1);
    const text = await only.metrics.instanceMetrics(port);
    expect(value(text, COUNT)).toBe(1);
  });
});
