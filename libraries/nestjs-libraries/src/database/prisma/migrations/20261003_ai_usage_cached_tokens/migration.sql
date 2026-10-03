-- Input tokens the AI provider served from its prompt cache (OpenAI
-- prompt_tokens_details.cached_tokens), part of inputAmount and billed at a
-- discount. Measured so prompt ordering can be tuned for cache hits (P5 §9.3b).
--
-- Additive with a default: existing rows read 0, nothing else changes.

ALTER TABLE "AiUsage" ADD COLUMN "cachedAmount" INTEGER NOT NULL DEFAULT 0;
