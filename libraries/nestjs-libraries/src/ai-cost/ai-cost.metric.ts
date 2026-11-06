import { Gauge, register } from 'prom-client';
import { costOfUsage, UsageRow } from '@gitroom/nestjs-libraries/ai-cost/ai-cost';

export const AI_COST_METRIC = 'postra_ai_cost_usd_24h';

// AiUsage is only indexed by organisation or engine before createdAt, so the
// 24 h slice is a scan of the table. Once in 10 minutes is plenty for a
// daily-cost warning and keeps the scrape (once a minute) off the database.
export const AI_COST_REFRESH_MS = 10 * 60_000;

type Load = (since: Date) => Promise<UsageRow[]>;

// What AI cost us over the last 24 hours, priced like /admin/ai-costs
// (ai-cost.ts): the early warning before the provider's hard limit. Every
// process with the database registers it; only the backend's is scraped.
// A failed load keeps the last value, so a database blip is not a drop to 0.
export const registerAiCostGauge = (load: Load, now: () => number = Date.now) => {
  if (register.getSingleMetric(AI_COST_METRIC)) {
    return;
  }
  let measuredAt = -Infinity;
  new Gauge({
    name: AI_COST_METRIC,
    help: 'AI cost in USD over the last 24 hours, from AiUsage rows priced by ai-cost.ts',
    // Every backend worker measures the same rows; /metrics merges the
    // workers (backend metrics.ts), and a sum would double the cost.
    aggregator: 'max',
    async collect() {
      const at = now();
      if (at - measuredAt < AI_COST_REFRESH_MS) {
        return;
      }
      try {
        const rows = await load(new Date(at - 86_400_000));
        this.set(Math.round(costOfUsage(rows).usd * 100) / 100);
        measuredAt = at;
      } catch {
        // keep the last value; try again on the next scrape
      }
    },
  });
};
