import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// E2E-11-61: a lifetime code was any string that AES-CBC decrypted without a
// padding error. Without a MAC about 1 random code in 250 does (measured
// 2026-10-26), and each one not used before gave Starter for good, the next
// Pro. Nothing in Postra issues codes, so the route, its page and the code
// generator went: a plan is given by an administrator (grant-lifetime, comp),
// never by a code a client sends. Read from the sources: importing the
// controller pulls in the whole backend.
const root = join(__dirname, '../../../../..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('billing redeems no codes', () => {
  it('has no route that takes a lifetime code', () => {
    const controller = source('apps/backend/src/api/routes/billing.controller.ts');
    expect(controller).toContain("@Controller('/billing')");
    expect(controller).not.toMatch(/@(Post|Put|Get)\(\s*'\/lifetime'/);
  });

  it('the Stripe service redeems none and nothing generates them', () => {
    const service = source('libraries/nestjs-libraries/src/services/stripe.service.ts');
    expect(service).toContain('export class StripeService');
    expect(service).not.toMatch(/lifetimeDeal|redeemLifetimeCode|fixedDecryption/);
    expect(
      existsSync(join(root, 'libraries/nestjs-libraries/src/services/codes.service.ts'))
    ).toBe(false);
  });

  it('the app has no page to enter one', () => {
    expect(
      existsSync(join(root, 'apps/frontend/src/app/(app)/(site)/billing/lifetime/page.tsx'))
    ).toBe(false);
  });
});
