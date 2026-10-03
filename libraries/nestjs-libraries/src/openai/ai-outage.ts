import { APIConnectionError, InternalServerError, RateLimitError } from 'openai';

// OpenAI down, overloaded or out of quota. The SDK has already retried by the
// time this reaches us, so our own retry loops stop and let it through to the
// 503 filter instead of masking it as "failed after 3 attempts".
export const AI_OUTAGE_ERRORS = [InternalServerError, RateLimitError, APIConnectionError] as const;

export const isAiOutage = (err: unknown) => AI_OUTAGE_ERRORS.some((type) => err instanceof type);
