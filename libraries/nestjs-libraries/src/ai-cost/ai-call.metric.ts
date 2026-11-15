import { Histogram, register } from 'prom-client';
import { isAiOutage } from '@gitroom/nestjs-libraries/openai/ai-outage';

export const AI_CALL_METRIC = 'postra_ai_call_duration_seconds';

// How the call ended: answered, the provider down or rate limited (after the
// SDK's own retries), refused by the provider (a safety filter, a bad
// request), or anything else.
export type AiCallOutcome = 'ok' | 'outage' | 'refused' | 'error';

// AiUsage says what a call cost; nothing said how long it took or how often
// it failed, so "is AI slow today" had no answer. One observation per model
// call, by the surface that made it. Text takes seconds, an image up to a
// minute or two. Counters and histograms are summed across the backend's
// workers by /metrics (backend metrics.ts).
const histogram = () =>
  (register.getSingleMetric(AI_CALL_METRIC) as Histogram<string> | undefined) ??
  new Histogram({
    name: AI_CALL_METRIC,
    help: 'Duration of one AI model call in seconds, by engine, model and outcome',
    labelNames: ['engine', 'model', 'outcome'],
    buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 13, 20, 30, 45, 60, 90, 180],
  });

export const aiCallOutcome = (err: unknown): AiCallOutcome => {
  if (isAiOutage(err)) return 'outage';
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (status === 429 || (typeof status === 'number' && status >= 500)) return 'outage';
  if (typeof status === 'number' && status >= 400) return 'refused';
  return 'error';
};

// Observational like AiUsage: a metric must never be why a call fails.
export const observeAiCall = (
  engine: string,
  model: string,
  outcome: AiCallOutcome,
  startedAt: number,
  now: () => number = Date.now
) => {
  try {
    histogram().observe({ engine, model, outcome }, Math.max(0, now() - startedAt) / 1000);
  } catch {
    /* never break the call */
  }
};

export const timeAiCall = async <T>(
  engine: string,
  model: string,
  call: () => Promise<T>
): Promise<T> => {
  const startedAt = Date.now();
  try {
    const result = await call();
    observeAiCall(engine, model, 'ok', startedAt);
    return result;
  } catch (err) {
    observeAiCall(engine, model, aiCallOutcome(err), startedAt);
    throw err;
  }
};
