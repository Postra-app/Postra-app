#!/usr/bin/env node
/**
 * Type-check every project that ships, in parallel.
 *
 * `pnpm build` used to be the only type gate, and it is not one: Next builds
 * skip type errors in files no route imports, and Nest builds never look at
 * spec files. This runs `tsc --noEmit` on each tsconfig and fails if any
 * project has an error.
 *
 * apps/extension is left out: it is the upstream browser extension, we do not
 * build or ship it.
 */
import { spawn } from 'node:child_process';

// The libraries' tsconfig.json is an empty solution file; the sources sit
// behind tsconfig.lib.json.
const projects = [
  'apps/backend/tsconfig.json',
  'apps/frontend/tsconfig.json',
  'apps/orchestrator/tsconfig.json',
  'apps/commands/tsconfig.json',
  'apps/sdk/tsconfig.json',
  'libraries/nestjs-libraries/tsconfig.lib.json',
  'libraries/react-shared-libraries/tsconfig.lib.json',
];

const run = (project) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('npx', ['tsc', '--noEmit', '-p', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) =>
      resolve({ project, code, output, seconds: (Date.now() - started) / 1000 })
    );
  });

const results = await Promise.all(projects.map(run));

let failed = 0;
for (const { project, code, output, seconds } of results) {
  const ok = code === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${project} (${seconds.toFixed(1)} s)`);
  if (!ok) console.log(output.trim().replace(/^/gm, '     '));
}

process.exit(failed ? 1 : 0);
