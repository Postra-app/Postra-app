/**
 * E2E-05-04, E2E-05-07 — lengths measured on production 2026-09-26 with
 * POST /posts/valid: posts the platforms accept were rejected as too long.
 */
import { providerTextLength } from '@gitroom/helpers/utils/count.length';

const url = 'https://example.com/' + 'a'.repeat(200);

describe('providerTextLength', () => {
  it('X counts a link as 23 (256 + space + link = 280, fits)', () => {
    expect(providerTextLength('x', 'a'.repeat(256) + ' ' + url)).toBe(280);
  });

  it('X still rejects what X rejects', () => {
    expect(providerTextLength('x', 'a'.repeat(281))).toBe(281);
    expect(providerTextLength('x', '😀'.repeat(141))).toBe(282);
  });

  it('Mastodon counts a link as 23 (476 + space + link = 500, fits)', () => {
    expect(providerTextLength('mastodon', 'a'.repeat(476) + ' ' + url)).toBe(500);
  });

  it('Bluesky counts graphemes: 300 emoji fit, links count in full', () => {
    expect(providerTextLength('bluesky', '😀'.repeat(300))).toBe(300);
    expect(providerTextLength('bluesky', '👨‍👩‍👧')).toBe(1);
    expect(providerTextLength('bluesky', 'a'.repeat(80) + ' ' + url)).toBe(301);
  });

  it('leaves every other platform on plain length', () => {
    expect(providerTextLength('telegram', '😀')).toBe(2);
    expect(providerTextLength('linkedin-page', 'a' + url)).toBe(1 + url.length);
    expect(providerTextLength(undefined, 'abc')).toBe(3);
  });
});
