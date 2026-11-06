import { readFileSync } from 'fs';
import { join } from 'path';

// pm2's process file (ecosystem.config.cjs) decides what runs in the app
// container. With one backend process, every restart of it was a stretch of
// 502 under load; two cluster workers keep the API answering while one of
// them is down. The names stay as they were: operators and automation
// address the apps as `backend`, `orchestrator` and `frontend`.

const root = join(__dirname, '..', '..', '..', '..');
const load = (env: Record<string, string | undefined> = {}) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    let config: { apps: Array<Record<string, any>> } | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      config = require(join(root, 'ecosystem.config.cjs'));
    });
    return config!;
  } finally {
    process.env = saved;
  }
};
const app = (name: string, env?: Record<string, string | undefined>) =>
  load(env).apps.find((a) => a.name === name)!;

describe('pm2 ecosystem', () => {
  it('runs the three apps under their old names', () => {
    expect(load().apps.map((a) => a.name)).toEqual(['backend', 'orchestrator', 'frontend']);
  });

  it('runs the backend as two cluster workers by default', () => {
    const backend = app('backend', { BACKEND_PROCESSES: undefined });
    expect(backend.exec_mode).toBe('cluster');
    expect(backend.instances).toBe(2);
    // The workers split the upload budget and merge /metrics by this number.
    expect(backend.env.BACKEND_PROCESSES).toBe('2');
    expect(app('backend', { BACKEND_PROCESSES: '3' }).instances).toBe(3);
  });

  it('waits for a new worker to listen before a reload stops the old one', () => {
    // pm2's default is 3 s; the backend listens only after a boot of tens of
    // seconds (main.ts), so a reload would stop the old worker too early.
    expect(app('backend').listen_timeout).toBeGreaterThanOrEqual(60000);
  });

  it('writes one log file per app, which the watchdog reads', () => {
    expect(app('backend').merge_logs).toBe(true);
  });

  it('keeps the stop timeouts the container stop grace is sized for', () => {
    expect(app('backend').kill_timeout).toBe(15000);
    expect(app('orchestrator').kill_timeout).toBe(50000);
  });

  it('runs Node itself, without a pnpm or dotenv wrapper above each server', () => {
    for (const a of load().apps) {
      expect(a.script).toMatch(/\.js$|\/next$/);
      expect(a.script).not.toMatch(/pnpm|dotenv/);
    }
  });

  it('starts from the root script with the .env every app read before', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['pm2-start']).toContain('dotenv -e .env -- pm2 start ecosystem.config.cjs');
    for (const name of ['backend', 'orchestrator', 'frontend']) {
      const appPkg = JSON.parse(
        readFileSync(join(root, 'apps', name, 'package.json'), 'utf8')
      );
      // One place says how an app is started under pm2.
      expect(appPkg.scripts.pm2).toBeUndefined();
    }
  });
});
