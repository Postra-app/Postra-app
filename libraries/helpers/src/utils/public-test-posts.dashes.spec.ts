import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The nightly canary and the channel matrix publish real, public posts that
// read as Postra ads, so they follow the same rule as the app: no long
// dashes (K. 10-09). The canary posted "posts it on time — postra.co.uk" to
// Mastodon on 2026-10-09, after the rule was in place.
const dir = join(__dirname, '..', '..', '..', '..', 'e2e', 'playwright');

const published: string[] = [];
for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(join(dir, name), 'utf8');
  const promo = text.match(/PROMO = \[([\s\S]*?)\];/);
  if (promo) published.push(...promo[1].split('\n').map((l) => `${name}: ${l.trim()}`));
  text.split('\n').forEach((line, i) => {
    if (/\bcontent\s*[:=]\s*[`'"]/.test(line)) published.push(`${name}:${i + 1} ${line.trim()}`);
  });
}

describe('public test posts', () => {
  it('finds the texts that get published', () => {
    expect(published.length).toBeGreaterThan(7);
  });

  it('have no long dashes', () => {
    expect(published.filter((l) => /[—–]/.test(l))).toEqual([]);
  });
});
