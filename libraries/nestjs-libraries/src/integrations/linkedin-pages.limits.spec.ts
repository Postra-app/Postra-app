import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LINKEDIN_PAGES_FULL_MESSAGE,
  LINKEDIN_PAGES_LIMITS_MESSAGE,
  LINKEDIN_PAGES_PER_WORKSPACE,
  LINKEDIN_PAGES_TOTAL,
  LINKEDIN_PAGE_POSTS_PER_DAY,
  linkedinPageConnectRefusal,
  linkedinPageDay,
} from './linkedin-pages.limits';
import { pricing } from '../database/prisma/subscriptions/pricing';

describe('LinkedIn Pages early access', () => {
  it('keeps the limits customers are told about', () => {
    expect(LINKEDIN_PAGES_PER_WORKSPACE).toBe(5);
    expect(LINKEDIN_PAGES_TOTAL).toBe(100);
    expect(LINKEDIN_PAGE_POSTS_PER_DAY).toBe(1);
    expect(LINKEDIN_PAGES_LIMITS_MESSAGE).toBe(
      'LinkedIn Pages are in early access: one post a day per Page, up to 5 Pages per workspace.'
    );
  });

  it('lets a workspace connect up to 5 Pages while Postra has room', () => {
    expect(linkedinPageConnectRefusal(0, 0)).toBeNull();
    expect(linkedinPageConnectRefusal(4, 99)).toBeNull();
    expect(linkedinPageConnectRefusal(5, 10)).toBe(LINKEDIN_PAGES_LIMITS_MESSAGE);
    expect(linkedinPageConnectRefusal(6, 10)).toBe(LINKEDIN_PAGES_LIMITS_MESSAGE);
  });

  it('refuses every workspace once 100 Pages are connected across Postra', () => {
    expect(linkedinPageConnectRefusal(0, 100)).toBe(LINKEDIN_PAGES_FULL_MESSAGE);
    expect(linkedinPageConnectRefusal(2, 150)).toBe(LINKEDIN_PAGES_FULL_MESSAGE);
  });

  it('counts a post on the UTC day it goes out', () => {
    const [start, end] = linkedinPageDay(new Date('2026-11-23T23:59:59Z'));
    expect(start.toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-24T00:00:00.000Z');
    const [next] = linkedinPageDay(new Date('2026-11-24T00:00:00Z'));
    expect(next.toISOString()).toBe('2026-11-24T00:00:00.000Z');
  });

  it('is offered on Business only', () => {
    expect(pricing.ULTIMATE.allowedProviders).toContain('linkedin-page');
    expect(pricing.TEAM.allowedProviders).toContain('linkedin-page');
    for (const tier of ['FREE', 'STANDARD', 'PRO']) {
      expect(pricing[tier].allowedProviders).not.toContain('linkedin-page');
    }
  });

  it('is offered to customers, not kept in preview', () => {
    // Read as source: importing the manager pulls in every provider.
    const manager = readFileSync(join(__dirname, 'integration.manager.ts'), 'utf8');
    const list = (name: string) =>
      manager.slice(manager.indexOf(`const ${name} = new Set`)).split(']);')[0];
    expect(list('enabledProviders')).toMatch(/^\s*'linkedin-page',/m);
    expect(list('previewProviders')).not.toMatch(/^\s*'linkedin-page',/m);
  });
});
