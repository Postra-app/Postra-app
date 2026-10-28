#!/usr/bin/env node
// Replays workflow histories against the compiled workflows of this build
// and exits non-zero if any of them no longer replays.
//
//   node scripts/replay-histories.mjs <dir with *.json histories>
//
// The deploy workflow runs it inside the image it just built, on the
// histories of the workflows running in production at that moment (exported
// by the operator's own infrastructure; this repository holds no history).
// A workflow change that does not match a live run's history would fail
// every task of that run after the deploy, so the deploy stops
// here instead: put the change behind patched() or in a new workflow version.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Worker } = require('@temporalio/worker');
const { historyFromJSON } = require('@temporalio/common/proto-utils');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: replay-histories.mjs <dir>');
  process.exit(2);
}

const workflowsPath =
  process.env.WORKFLOWS_PATH ||
  path.resolve(
    import.meta.dirname,
    '../apps/orchestrator/dist/apps/orchestrator/src/workflows/index.js'
  );

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();
if (!files.length) {
  console.log('No histories to replay.');
  process.exit(0);
}

async function* histories() {
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const started =
      json.events?.[0]?.workflowExecutionStartedEventAttributes ?? {};
    yield {
      workflowId: `${started.workflowType?.name ?? 'workflow'} ${file}`,
      history: historyFromJSON(json),
    };
  }
}

let failed = 0;
for await (const result of Worker.runReplayHistories(
  { workflowsPath, replayName: 'deploy-replay' },
  histories()
)) {
  if (result.error) {
    failed++;
    console.error(`✗ ${result.workflowId}: ${result.error.message}`);
  } else {
    console.log(`✓ ${result.workflowId}`);
  }
}
console.log(`${files.length - failed}/${files.length} histories replay on this build`);
process.exit(failed ? 1 : 0);
