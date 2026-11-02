import { register } from 'prom-client';
import {
  AI_COST_METRIC,
  AI_COST_REFRESH_MS,
  registerAiCostGauge,
} from './ai-cost.metric';

// The provider's hard limit stops every AI call at once; this gauge is what
// the Grafana rule "AI cost over the last 24 hours" mails on before that.
describe('AI cost gauge', () => {
  afterEach(() => register.removeSingleMetric(AI_COST_METRIC));

  const value = async () =>
    (await register.getSingleMetric(AI_COST_METRIC)!.get()).values[0]?.value;

  it('prices the last 24 hours of AiUsage like the admin report', async () => {
    const now = Date.UTC(2026, 10, 2, 16, 0, 0);
    const load = jest.fn(async () => [
      // 1M input + 1M output of gpt-5.5 = $5 + $30
      { model: 'gpt-5.5', unit: 'tokens', inputAmount: 1_000_000, cachedAmount: 0, outputAmount: 1_000_000 },
      // 10 images at $0.053
      { model: 'gpt-image-2', unit: 'images', inputAmount: 10 },
    ]);
    registerAiCostGauge(load, () => now);

    expect(await value()).toBe(35.53);
    expect(load).toHaveBeenCalledWith(new Date(now - 86_400_000));
  });

  it('asks the database at most once per refresh window', async () => {
    let now = 0;
    let tokens = 1_000_000; // gpt-5.5 input = $5
    const load = jest.fn(async () => [
      { model: 'gpt-5.5', unit: 'tokens', inputAmount: tokens },
    ]);
    registerAiCostGauge(load, () => now);

    expect(await value()).toBe(5);
    tokens = 5_000_000;
    now += 60_000;
    expect(await value()).toBe(5);
    expect(load).toHaveBeenCalledTimes(1);
    now += AI_COST_REFRESH_MS;
    expect(await value()).toBe(25);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the last value when the database does not answer', async () => {
    let now = 0;
    let fail = false;
    registerAiCostGauge(async () => {
      if (fail) throw new Error('connection refused');
      return [{ model: 'gpt-5.5', unit: 'tokens', inputAmount: 4_000_000 }];
    }, () => now);
    expect(await value()).toBe(20);
    fail = true;
    now += AI_COST_REFRESH_MS;
    expect(await value()).toBe(20);
  });

  it('registers once however many services ask', () => {
    registerAiCostGauge(async () => []);
    expect(() => registerAiCostGauge(async () => [])).not.toThrow();
  });
});
