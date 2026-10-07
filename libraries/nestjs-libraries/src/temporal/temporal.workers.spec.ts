// The real provider list, without the ESM-only imports Jest cannot load.
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { temporalWorkers } from '@gitroom/nestjs-libraries/temporal/temporal.module';

// The orchestrator runs one Temporal worker per task queue. Only 'main' runs
// workflows; a provider worker given the workflows bundled them again and kept
// its own workflow thread, which put the orchestrator at 1.6 GB RSS on a
// 3.8 GB box (alarm 2026-10-07).

describe('temporal workers', () => {
  const workers = temporalWorkers('/workflows', []);

  it('runs workflows on the main queue only', () => {
    expect(workers.length).toBeGreaterThan(10);
    expect(
      workers.filter((w: any) => w.workflowsPath || w.workflowBundle)
        .map((w) => w.taskQueue)
    ).toEqual(['main']);
  });

  it('keeps one activity worker per provider queue', () => {
    const queues = workers.map((w) => w.taskQueue);
    expect(new Set(queues).size).toBe(queues.length);
    expect(queues).toEqual(expect.arrayContaining(['main', 'x', 'mastodon']));
    expect(workers.every((w) => w.activityClasses)).toBe(true);
  });
});

// The split above is only safe while nothing starts a workflow on a provider
// queue: such a workflow would wait for a workflow worker that no longer
// polls there. Every start, signalWithStart and startChild in the code has to
// name 'main' or inherit it.
describe('workflow starts', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) files.push(path);
    }
  };
  walk(join(root, 'apps'));
  walk(join(root, 'libraries'));

  const starts = files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [
      ...text.matchAll(/(workflow\??\.start|signalWithStart|startChild)\(/g),
    ].map((m) => {
      // The options up to the workflow's own arguments; a taskQueue inside
      // args is the provider queue handed to the workflow, not where it runs.
      const options = text.slice(m.index!, m.index! + 600).split(/\bargs:/)[0];
      const queue = options.match(/taskQueue:\s*([^,\n}]+)/)?.[1]?.trim();
      return { at: `${file.slice(root.length + 1)}:${m[1]}`, queue };
    });
  });

  it('finds the starts it guards', () => {
    expect(starts.length).toBeGreaterThan(5);
  });

  it('starts every workflow on main', () => {
    expect(
      starts.filter(({ queue }) => queue !== undefined && queue !== "'main'")
    ).toEqual([]);
  });
});
