/**
 * housekeepingWorkflow runs for a day per run, so a deploy always lands on a
 * live run and the new code has to replay that run's history. On 2026-10-08
 * the margin guard was added between the purge and the sleep without a patch:
 * the production run started that night failed every workflow task from
 * 2026-10-09 on with "[TMPRL1100] Nondeterminism error" (E2E-11-15), so no
 * retention, no media sweep and no margin guard ran for a week.
 *
 * The history is that production run (events 1-14, up to the workflow task
 * that failed), replayed on the real Temporal workflow runtime.
 */
import path from 'path';
import { replayHistory } from './replay.helper';

jest.setTimeout(120_000);

describe('housekeepingWorkflow replay', () => {
  it('replays the run that was alive when the margin guard shipped', async () => {
    await expect(
      replayHistory(
        path.join(__dirname, 'housekeeping.workflow.ts'),
        path.join(__dirname, '__histories__/housekeeping-2026-10-08.json')
      )
    ).resolves.toBeUndefined();
  });
});
