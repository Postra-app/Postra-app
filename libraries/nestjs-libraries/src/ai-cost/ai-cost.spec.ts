import {
  AI_PRICES_USD,
  costOfUsage,
  marginReport,
} from '@gitroom/nestjs-libraries/ai-cost/ai-cost';

// Prices from developers.openai.com/api/docs/pricing and the plan's analysis
// (Plan/lunchdayfinal.md "💷 Analiza", 2026-10-08): pinned, so a change of
// price is a deliberate change here.
describe('AI cost', () => {
  it('prices the assistant model and the text models per 1M tokens', () => {
    expect(AI_PRICES_USD['gpt-5.6-luna']).toEqual({ input: 0.2, cached: 0.02, output: 1.2 });
    expect(AI_PRICES_USD['gpt-5.5']).toEqual({ input: 5, cached: 0.5, output: 30 });
    expect(AI_PRICES_USD['gpt-4.1']).toEqual({ input: 2, cached: 0.5, output: 8 });
  });

  it('charges cached input at the cached price, the rest at the input price', () => {
    // 1M input of which 0.5M cached, 0.1M output on luna:
    // 0.5 × 0.20 + 0.5 × 0.02 + 0.1 × 1.20 = 0.10 + 0.01 + 0.12
    const { usd } = costOfUsage([
      { model: 'gpt-5.6-luna', unit: 'tokens', inputAmount: 1_000_000, cachedAmount: 500_000, outputAmount: 100_000 },
    ]);
    expect(usd).toBeCloseTo(0.23, 6);
  });

  it('prices images, video clips and transcription per unit; counted questions cost nothing', () => {
    const { usd } = costOfUsage([
      { model: 'gpt-image-2', unit: 'images', inputAmount: 10 },
      { model: 'veo3_fast', unit: 'videos', inputAmount: 2 },
      { model: 'whisper-1', unit: 'seconds', inputAmount: 600 },
      { model: 'message', unit: 'messages', inputAmount: 500 },
    ]);
    // 10 × 0.053 + 2 × 0.325 + 10 min × 0.006
    expect(usd).toBeCloseTo(0.53 + 0.65 + 0.06, 6);
  });

  // /admin/ai-costs on prod 2026-10-09 listed gpt-4o (Studio's vision call,
  // studio-ai.service.ts) as unknown, priced like gpt-5.5.
  it('prices the Studio vision model gpt-4o at its own price', () => {
    const { usd, unknownModels } = costOfUsage([
      { model: 'gpt-4o', unit: 'tokens', inputAmount: 1_000_000, cachedAmount: 200_000, outputAmount: 100_000 },
    ]);
    // 0.8 × 2.50 + 0.2 × 1.25 + 0.1 × 10
    expect(usd).toBeCloseTo(2 + 0.25 + 1, 6);
    expect(unknownModels).toEqual([]);
  });

  it('prices an unknown model like the dearest one, and says which it was', () => {
    const { usd, unknownModels } = costOfUsage([
      { model: 'gpt-9-mystery', unit: 'tokens', inputAmount: 1_000_000, outputAmount: 0 },
    ]);
    expect(usd).toBeCloseTo(5, 6);
    expect(unknownModels).toEqual(['gpt-9-mystery']);
  });
});

describe('margin report', () => {
  const orgs = [
    { id: 'starter', name: 'Bakery', tier: 'STANDARD', period: 'MONTHLY', isLifetime: false, isTrailing: false },
    { id: 'yearly', name: 'Agency', tier: 'ULTIMATE', period: 'YEARLY', isLifetime: false, isTrailing: false },
    { id: 'trial', name: 'Trial Co', tier: 'PRO', period: 'MONTHLY', isLifetime: false, isTrailing: true },
    { id: 'lifetime', name: 'Ours', tier: 'ULTIMATE', period: 'MONTHLY', isLifetime: true, isTrailing: false },
  ];
  const costs = { starter: 18, yearly: 10, trial: 40, lifetime: 500 };

  it('flags an organisation whose AI cost passes 70% of its plan price, in pounds', () => {
    // Starter £19 = $25.46 at 1.34; $18 = 70.7%.
    const report = marginReport(orgs, costs, { usdPerGbp: 1.34, threshold: 0.7 });
    const starter = report.find((r) => r.organizationId === 'starter')!;
    expect(starter.planGbp).toBe(19);
    expect(starter.share).toBeCloseTo(18 / 1.34 / 19, 6);
    expect(starter.alert).toBe(true);
  });

  it('takes a yearly plan as a twelfth of its price', () => {
    const report = marginReport(orgs, costs, { usdPerGbp: 1.34, threshold: 0.7 });
    expect(report.find((r) => r.organizationId === 'yearly')!.planGbp).toBeCloseTo(790 / 12, 6);
  });

  it('watches a trial against its plan price, and leaves lifetime grants out', () => {
    const report = marginReport(orgs, costs, { usdPerGbp: 1.34, threshold: 0.7 });
    expect(report.find((r) => r.organizationId === 'trial')).toMatchObject({ trial: true, alert: true });
    expect(report.find((r) => r.organizationId === 'lifetime')).toBeUndefined();
  });

  it('puts the dearest first', () => {
    const report = marginReport(orgs, costs, { usdPerGbp: 1.34, threshold: 0.7 });
    expect(report.map((r) => r.organizationId)).toEqual(['trial', 'starter', 'yearly']);
  });
});
