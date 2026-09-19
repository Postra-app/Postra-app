import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * An unknown platform name in the URL is a client mistake, not a server
 * failure, and it has to answer 4xx. Measured on production 2026-09-19 while
 * reviewing Sentry:
 *
 *   GET /integrations/social/nieistniejacy
 *     → {"statusCode":500,"message":"Internal server error"}
 *
 * The cause was `throw new Error('Integration not allowed')`, which reaches
 * NestJS's global filter as an unhandled exception: a 500 for the caller and a
 * Sentry event for us. The per-tier check a few lines below the same guard
 * already threw `HttpException(…, 402)`, so the file knew how.
 *
 * Read as source rather than imported: pulling IntegrationsController into a
 * test drags the whole integration manager with it (same reason as
 * media.controller.ai-gates.spec.ts).
 */
const source = readFileSync(join(__dirname, 'integrations.controller.ts'), 'utf8');

describe('GET /integrations/social/:integration — unknown platform', () => {
  it('⛔ answers 4xx, not a bare Error that becomes a 500', () => {
    expect(source).toContain('Unknown platform');
    expect(source).not.toContain("throw new Error('Integration not allowed')");
  });

  it('throws it as an HttpException with an explicit status', () => {
    const guard = source.slice(
      source.indexOf('getAllowedSocialsIntegrations'),
      source.indexOf('Per-tier platform gating')
    );
    expect(guard).toMatch(/throw new HttpException\([^)]*400\s*\)/s);
  });
});

/**
 * ⚠️ The same shape is still in 15 other places in these controllers — every one of them is
 * a 500 waiting for the right URL. Not fixed here because only the one above
 * was measured, and this file is close to upstream (see the cherry-pick rule
 * for the Postiz fork): widening the diff has a cost of its own.
 *
 * This count is a tripwire, not a target. If it goes UP, someone added another
 * one; if it goes DOWN, someone fixed a few and should lower the number.
 */
describe('bare Error throws left in the API controllers', () => {
  const FILES = [
    'integrations.controller.ts',
    'no.auth.integrations.controller.ts',
    'enterprise.controller.ts',
    'public.controller.ts',
    'admin.controller.ts',
  ];

  it('has not grown beyond the 15 known on 2026-09-19', () => {
    const total = FILES.reduce((sum, f) => {
      const text = readFileSync(join(__dirname, f), 'utf8');
      return sum + (text.match(/throw new Error\(/g) || []).length;
    }, 0);
    expect(total).toBeLessThanOrEqual(15);
  });
});
