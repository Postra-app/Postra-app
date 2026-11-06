// pm2's process file for the app container: var/docker/start.sh runs
// `pnpm run pm2-start`, which starts this file under `dotenv -e .env`, so every
// app gets the same environment as before (pm2 hands the starting shell's
// environment to its apps).
//
// Each app is a Node process pm2 owns directly. It used to be
// `pm2 start pnpm -- start`: a pnpm wrapper and a dotenv-cli wrapper, each a
// Node process of its own, above every server, and the reason pm2 needed
// `ps` to reach the real process on restart (Dockerfile.dev).
//
// The backend runs in cluster mode, BACKEND_PROCESSES workers sharing port
// 3000. One worker that crashes or restarts no longer takes the API down with
// it (with one process, a restart was tens of seconds of 502 under load),
// and `pm2 reload backend` replaces the workers one at a time:
// the old one stops only once its successor listens. Whatever a worker keeps
// in memory is per worker: the large-upload budget is split between them
// (upload-slots.guard.ts) and /metrics aggregates all of them (metrics.ts).
const path = require('node:path');

const backendProcesses = Math.max(1, Number(process.env.BACKEND_PROCESSES) || 2);
const app = (name) => path.join(__dirname, 'apps', name);

module.exports = {
  apps: [
    {
      name: 'backend',
      cwd: app('backend'),
      script: path.join(app('backend'), 'dist/apps/backend/src/main.js'),
      node_args: '--experimental-require-module',
      exec_mode: 'cluster',
      instances: backendProcesses,
      env: { BACKEND_PROCESSES: String(backendProcesses) },
      // A worker counts as started when it listens, and the backend listens
      // only at the end of its boot (main.ts): Mastra, migrations of its
      // store, every module. pm2's default of 3 s would let a reload stop
      // the old worker long before the new one answers.
      listen_timeout: 120000,
      kill_timeout: 15000,
      // One backend-out.log and backend-error.log, as before: in cluster mode
      // pm2 would write a file per worker (backend-out-1.log), and the
      // watchdog on the instance reads the boot steps from backend-out.log.
      merge_logs: true,
    },
    {
      name: 'orchestrator',
      cwd: app('orchestrator'),
      script: path.join(app('orchestrator'), 'dist/apps/orchestrator/src/main.js'),
      node_args: '--experimental-require-module',
      // The Temporal worker drains for up to 45 s (temporal.module.ts).
      kill_timeout: 50000,
    },
    {
      name: 'frontend',
      cwd: app('frontend'),
      script: require.resolve('next/dist/bin/next', { paths: [app('frontend')] }),
      args: 'start -p 4200',
    },
  ],
};
