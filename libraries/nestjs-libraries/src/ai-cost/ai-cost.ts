import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

/**
 * What AI cost us, from AiUsage rows — the margin guard (Plan/lunchdayfinal.md
 * "💷 Analiza" pkt 4.5 and 9e): an organisation whose AI costs more than 70%
 * of its plan price is one to look at before it eats the margin.
 *
 * Text prices per 1M tokens from developers.openai.com/api/docs/pricing
 * (2026-10-08, standard tier). Per unit: an image ≈ $0.053 (OpenAI's image
 * calculator, the plan's analysis), a Veo 3.1 Fast clip at 1080p 65 kie.ai
 * credits = $0.325, Whisper $0.006 a minute. Change a price here and in the
 * spec together.
 */
export const AI_PRICES_USD: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
  'gpt-5.6-terra': { input: 2, cached: 0.2, output: 12 },
  'gpt-5.5': { input: 5, cached: 0.5, output: 30 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-4.1': { input: 2, cached: 0.5, output: 8 },
  // Studio's vision call (studio-ai.service.ts MODEL_VISION).
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'text-embedding-3-small': { input: 0.02, cached: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, cached: 0.13, output: 0 },
};

// A model missing from the table is priced like the dearest one, so a new
// model can only make the guard louder, never quieter.
const DEAREST = AI_PRICES_USD['gpt-5.5'];

const PER_UNIT_USD: Record<string, (model: string) => number> = {
  images: () => 0.053,
  videos: (model) => (model === 'veo3_fast' ? 0.325 : 0.4),
  seconds: () => 0.006 / 60,
  messages: () => 0,
};

export interface UsageRow {
  model: string;
  unit: string;
  inputAmount?: number | null;
  cachedAmount?: number | null;
  outputAmount?: number | null;
}

export const costOfUsage = (rows: UsageRow[]) => {
  const unknown = new Set<string>();
  let usd = 0;
  for (const row of rows) {
    const input = row.inputAmount ?? 0;
    if (row.unit && row.unit !== 'tokens') {
      const price = PER_UNIT_USD[row.unit];
      usd += price ? input * price(row.model) : 0;
      continue;
    }
    const known = AI_PRICES_USD[row.model];
    if (!known) unknown.add(row.model);
    const price = known || DEAREST;
    const cached = Math.min(row.cachedAmount ?? 0, input);
    usd +=
      ((input - cached) * price.input + cached * price.cached + (row.outputAmount ?? 0) * price.output) /
      1_000_000;
  }
  return { usd, unknownModels: [...unknown] };
};

export interface MarginOrg {
  id: string;
  name: string;
  tier: string;
  period: string;
  isLifetime: boolean;
  isTrailing: boolean;
}

export interface MarginRow {
  organizationId: string;
  name: string;
  tier: string;
  trial: boolean;
  planGbp: number;
  costUsd: number;
  share: number;
  alert: boolean;
}

/**
 * Each paying organisation's AI cost against its plan price. A lifetime grant
 * pays nothing to compare with and is left out; a trial is measured against
 * the plan it will turn into, since a trial burning AI is the case to catch.
 */
export const marginReport = (
  orgs: MarginOrg[],
  costUsdByOrg: Record<string, number>,
  { usdPerGbp, threshold }: { usdPerGbp: number; threshold: number }
): MarginRow[] =>
  orgs
    .filter((o) => !o.isLifetime && pricing[o.tier])
    .map((o) => {
      const plan = pricing[o.tier];
      const planGbp = o.period === 'YEARLY' ? plan.year_price / 12 : plan.month_price;
      const costUsd = costUsdByOrg[o.id] ?? 0;
      const share = planGbp > 0 ? costUsd / usdPerGbp / planGbp : 0;
      return {
        organizationId: o.id,
        name: o.name,
        tier: o.tier,
        trial: o.isTrailing,
        planGbp,
        costUsd,
        share,
        alert: share >= threshold,
      };
    })
    .filter((r) => r.costUsd > 0)
    .sort((a, b) => b.share - a.share);

// The rate the plan's analysis used (mid-September 2026); MARGIN_USD_PER_GBP
// overrides it without a release.
export const marginSettings = () => ({
  usdPerGbp: Number(process.env.MARGIN_USD_PER_GBP) || 1.34,
  threshold: 0.7,
});
