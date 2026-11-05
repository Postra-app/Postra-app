/**
 * The error types body-parser and raw-body give a request the client got
 * wrong: a body over the limit, malformed JSON, an unknown encoding or
 * charset, a request the client aborted. Each comes with a 4xx status, and
 * Nest answers with it.
 */
const CLIENT_REQUEST_ERROR_TYPES = new Set([
  'entity.too.large',
  'entity.parse.failed',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
  'parameters.too.many',
]);

/**
 * True when Sentry is about to report a request the client got wrong.
 *
 * SentryGlobalFilter skips Nest's HttpException, but body-parser throws
 * http-errors instead, so a 3 MB POST to /copilot/agent reached Sentry as
 * an unhandled PayloadTooLargeError although the client got its
 * 413. Anyone can send those, as many as they like, and each would spend the
 * Sentry quota on noise.
 *
 * Narrow on purpose: a body-parser error type AND a 4xx status. Its 5xx
 * types (a stream fault on our side) and app errors that carry a status are
 * still reported.
 */
export function isClientRequestError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const { type, status, statusCode } = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const code = typeof status === 'number' ? status : statusCode;
  return (
    typeof type === 'string' &&
    CLIENT_REQUEST_ERROR_TYPES.has(type) &&
    typeof code === 'number' &&
    code >= 400 &&
    code < 500
  );
}
