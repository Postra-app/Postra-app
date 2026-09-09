import {
  AGENT_MAX_STEPS,
  BUDGET_CHECK_EVERY_STEPS,
  shouldStopForBudget,
} from '@gitroom/nestjs-libraries/chat/agent-budget';

const org = JSON.stringify({ id: 'org-1' });
const exhausted = async () => ({ credits: 0 });
const plenty = async () => ({ credits: 1_000 });

describe('agent budget stop condition', () => {
  it('does nothing when billing is off — the ledger is advisory there', async () => {
    expect(
      await shouldStopForBudget(BUDGET_CHECK_EVERY_STEPS, org, exhausted, false)
    ).toBe(false);
  });

  it('only looks every few steps, so tools do not each carry a query', async () => {
    const calls: number[] = [];
    const counting = async () => {
      calls.push(1);
      return { credits: 0 };
    };

    for (let step = 1; step <= BUDGET_CHECK_EVERY_STEPS * 2; step++) {
      await shouldStopForBudget(step, org, counting, true);
    }

    expect(calls.length).toBe(2);
  });

  it('stops the run once the allowance is gone', async () => {
    expect(
      await shouldStopForBudget(BUDGET_CHECK_EVERY_STEPS, org, exhausted, true)
    ).toBe(true);
  });

  it('keeps going while there is allowance left', async () => {
    expect(
      await shouldStopForBudget(BUDGET_CHECK_EVERY_STEPS, org, plenty, true)
    ).toBe(false);
  });

  it('keeps going when the check itself fails', async () => {
    const broken = async () => {
      throw new Error('database is having a moment');
    };
    expect(
      await shouldStopForBudget(BUDGET_CHECK_EVERY_STEPS, org, broken, true)
    ).toBe(false);
  });

  it('keeps going when there is no organisation on the context', async () => {
    expect(
      await shouldStopForBudget(
        BUDGET_CHECK_EVERY_STEPS,
        undefined,
        exhausted,
        true
      )
    ).toBe(false);
  });

  it('bounds the run at a number a real conversation stays under', () => {
    expect(AGENT_MAX_STEPS).toBeGreaterThanOrEqual(10);
    expect(AGENT_MAX_STEPS).toBeLessThanOrEqual(50);
  });
});
