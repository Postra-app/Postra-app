import {
  providerErrorMessage,
  sanitizeSecrets,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

// Post.error holds the whole Temporal failure (JSON.stringify of an
// ActivityFailure): nested causes, stack traces with container paths, worker
// identity. The client only needs the sentence — the platform's own reason
// when the activity kept it, otherwise the failure message. The full trace
// stays in the Errors table (E2E-05-10).
export function readablePostError(raw?: string | null): string | null {
  if (!raw) {
    return null;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Older rows and non-Temporal failures are plain text already.
    return sanitizeSecrets(raw.split('\n')[0]).slice(0, 300);
  }

  const cause = parsed?.cause ?? parsed?.failure?.cause ?? parsed;
  const fromPlatform = [cause?.details, cause?.failure?.details]
    .flat()
    .map((d: any) => (typeof d?.json === 'string' ? providerErrorMessage(d.json) : undefined))
    .find(Boolean);

  const message = [
    fromPlatform,
    cause?.failure?.message,
    cause?.message,
    parsed?.message,
  ].find(
    (m) => typeof m === 'string' && m.trim() && m !== 'Activity task failed'
  );

  return message ? sanitizeSecrets(message.trim()).slice(0, 300) : null;
}
