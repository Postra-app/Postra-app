import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { Worker } from '@temporalio/worker';

const repo = path.resolve(__dirname, '../../../..');

/**
 * Replays a workflow history exported from Temporal (`temporal workflow show
 * -o json`) against the current code of one workflow file, on the real
 * workflow runtime. A long-lived workflow (daily housekeeping, streaks,
 * Auto Post) always has a run alive at deploy time, and a change that does
 * not match its history fails every workflow task of that run.
 *
 * Two local quirks are worked around here, not in the SDK:
 * - the SDK's own JSON parser trips over the two copies of protobufjs
 *   (one under @temporalio/common, one under @temporalio/proto), so the
 *   history is decoded with the copy that owns the History type;
 * - the bundler resolves real paths, so the workflow is transpiled into a
 *   real (not symlinked) temp directory and resolved against the repo's
 *   node_modules, the way the worker gets compiled JS in production.
 */
export async function replayHistory(workflowFile: string, historyFile: string) {
  const protoDir = path.dirname(
    require.resolve('@temporalio/proto/package.json', {
      paths: [path.dirname(require.resolve('@temporalio/worker'))],
    })
  );
  const { fromJson } = require(require.resolve('protobufjs/ext/protojson', {
    paths: [protoDir],
  }));
  const json = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  const history = fromJson(
    require(protoDir).temporal.api.history.v1.History,
    json,
    { ignoreUnknownFields: true }
  );

  const out = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'replay-'));
  try {
    const js = ts.transpileModule(fs.readFileSync(workflowFile, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const entry = path.join(out, path.basename(workflowFile, '.ts') + '.js');
    fs.writeFileSync(entry, js);

    await Worker.runReplayHistory(
      {
        workflowsPath: entry,
        bundlerOptions: {
          webpackConfigHook: (config) => {
            config.resolve = {
              ...config.resolve,
              modules: [path.join(repo, 'node_modules'), 'node_modules'],
            };
            return config;
          },
        },
      },
      history,
      json.events?.[0]?.workflowExecutionStartedEventAttributes?.workflowId ??
        path.basename(historyFile, '.json')
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
