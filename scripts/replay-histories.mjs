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

// The workers put tracing interceptors into the workflow sandbox when
// OTEL_TRACES_ENDPOINT is set, and that setting can change without a new
// build. So every history has to replay both ways: on the workflows alone
// and with the interceptors around them.
const {
  makeWorkflowExporter,
} = require('@temporalio/interceptors-opentelemetry-v2');
const { NoopSpanProcessor } = require('@opentelemetry/sdk-trace');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const passes = [
  { name: 'workflows alone', options: {} },
  {
    name: 'with tracing interceptors',
    options: {
      interceptors: {
        workflowModules: [
          require.resolve(
            '@temporalio/interceptors-opentelemetry-v2/lib/workflow-interceptors'
          ),
        ],
      },
      // A replay exports nothing; the sink only has to exist.
      sinks: {
        exporter: makeWorkflowExporter(
          new NoopSpanProcessor(),
          resourceFromAttributes({})
        ),
      },
    },
  },
];

let failed = 0;
for (const pass of passes) {
  let failedHere = 0;
  for await (const result of Worker.runReplayHistories(
    { workflowsPath, replayName: 'deploy-replay', ...pass.options },
    histories()
  )) {
    if (result.error) {
      failedHere++;
      console.error(
        `✗ ${result.workflowId} (${pass.name}): ${result.error.message}`
      );
    } else if (pass === passes[0]) {
      console.log(`✓ ${result.workflowId}`);
    }
  }
  console.log(
    `${files.length - failedHere}/${files.length} histories replay on this build, ${pass.name}`
  );
  failed += failedHere;
}
process.exit(failed ? 1 : 0);
