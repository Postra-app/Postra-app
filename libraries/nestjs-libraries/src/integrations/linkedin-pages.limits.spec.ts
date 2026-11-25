import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LINKEDIN_PAGES_FULL_MESSAGE,
  LINKEDIN_PAGES_LIMITS_MESSAGE,
  LINKEDIN_PAGES_PER_WORKSPACE,
  LINKEDIN_PAGES_TOTAL,
  LINKEDIN_PAGE_POSTS_PER_DAY,
  LINKEDIN_PAGES_NO_REPEAT_MESSAGE,
  isLinkedinPagesNotice,
  linkedinPageConnectRefusal,
  linkedinPageDay,
  linkedinPageDailyLimitApplies,
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

  it('checks the caps and the daily limit behind a lock, and covers moves and repeats', () => {
    const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');
    const service = read('../database/prisma/posts/posts.service.ts');
    const save = service.slice(service.indexOf('  async createPost('));
    // inside the save's transaction, before the rows are locked
    expect(save.indexOf('this.refuseSecondLinkedinPagePost(tx,')).toBeGreaterThan(0);
    expect(save.indexOf('this.refuseSecondLinkedinPagePost(tx,')).toBeLessThan(
      save.indexOf('this._postRepository.lockForSave(tx,')
    );
    const move = service.slice(service.indexOf('  async changeDate('));
    expect(move).toMatch(/lockLinkedinPage\([\s\S]{0,400}countChannelPostsBetween/);
    expect(service).toContain('LINKEDIN_PAGES_NO_REPEAT_MESSAGE');
    const callback = read('../../../../apps/backend/src/api/routes/no.auth.integrations.controller.ts');
    expect(callback).toMatch(/linkedin-pages-connect[\s\S]{0,2500}linkedinPageRefusal/);
  });

  it('tells the customer about a limit as information, not as a failed save', () => {
    for (const notice of [
      LINKEDIN_PAGES_LIMITS_MESSAGE,
      LINKEDIN_PAGES_FULL_MESSAGE,
      LINKEDIN_PAGES_NO_REPEAT_MESSAGE,
    ]) {
      expect(isLinkedinPagesNotice(notice)).toBe(true);
    }
    expect(isLinkedinPagesNotice('Invalid date')).toBe(false);
    expect(isLinkedinPagesNotice(undefined)).toBe(false);
    const read = (file: string) =>
      readFileSync(join(__dirname, '../../../../apps/frontend/src/components', file), 'utf8');
    // the editor shows the notice without "Could not save the post", and the
    // calendar says why a dragged post went back
    expect(read('new-launch/manage.modal.tsx')).toMatch(
      /isLinkedinPagesNotice\(reason\)\) \{\s*toaster\.show\(reason, 'warning'\);\s*return;/
    );
    expect(read('launches/calendar.tsx')).toMatch(
      /isLinkedinPagesNotice\(reason\)\) \{\s*toaster\.show\(reason, 'warning'\);/
    );
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

  // The day's cap keeps every workspace inside the API budget LinkedIn gives
  // the whole app; a deployment can name workspaces it does not apply to.
  describe('the daily post limit', () => {
    const saved = process.env.LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS;
    afterEach(() => {
      if (saved === undefined) delete process.env.LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS;
      else process.env.LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS = saved;
    });

    it('applies to every workspace when no workspace is named', () => {
      delete process.env.LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS;
      expect(linkedinPageDailyLimitApplies('org-1')).toBe(true);
    });

    it('does not apply to a workspace named in LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS', () => {
      process.env.LINKEDIN_PAGES_UNLIMITED_ORGANIZATIONS = ' org-ours , org-review';
      expect(linkedinPageDailyLimitApplies('org-ours')).toBe(false);
      expect(linkedinPageDailyLimitApplies('org-review')).toBe(false);
      expect(linkedinPageDailyLimitApplies('org-customer')).toBe(true);
      expect(linkedinPageDailyLimitApplies('')).toBe(true);
    });
  });
});
