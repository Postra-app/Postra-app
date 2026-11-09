import { APP_TABS, FAQ_ITEMS, MOBILE_APP } from './help.data';

// Help told customers things the app does not do:
// LinkedIn Pages is "Coming soon" for new connections (integration.manager.ts
// enabledProviders), so it has no analytics page and no plugs to offer; and a
// failed post's error shows on the red "!" of its calendar tile, not inside
// the opened post.
describe('Help text matches the app', () => {
  const tab = (id: string) => APP_TABS.find((t) => t.id === id)!;

  it('does not offer LinkedIn Pages analytics or plugs', () => {
    expect(tab('analytics').description).not.toContain('LinkedIn Pages');
    expect(tab('plugs').description).not.toContain('LinkedIn Pages');
  });

  it('says where a failed post shows its error', () => {
    const failed = FAQ_ITEMS.find((f) => f.question.startsWith('A post failed to publish'))!;
    expect(failed.answer).not.toContain('Open the post from the Calendar to see the error');
    expect(failed.answer).toContain('red !');
  });
});

// The customer has to learn the media storage and the
// phone's limits from Help, not from a refused upload.
describe('Help tells the limits', () => {
  it('Media names the storage of every plan and the trial', () => {
    const media = APP_TABS.find((t) => t.id === 'media')!.description;
    for (const part of ['10 GB on Starter', '25 GB on Pro', '100 GB on Business', '2 GB during the free trial']) {
      expect(media).toContain(part);
    }
  });

  it('the FAQ answers how much storage there is', () => {
    const faq = FAQ_ITEMS.find((f) => /storage/.test(f.question))!;
    expect(faq.answer).toContain('10 GB on Starter');
  });

  it('the mobile app section has the 10 minute / 1 GB video limit and what stays on the web', () => {
    expect(MOBILE_APP.limits.join(' ')).toContain('10 minutes and 1 GB');
    expect(MOBILE_APP.webOnly.join(' ')).toContain('Studio');
  });
});

// Help said "3, 6 or 12" channels while Business has 15: the numbers were
// typed in by hand. Every plan number in these answers is the plan's own.
describe('Help numbers are the plans', () => {
  const { pricing, TRIAL_LIMITS, TRIAL_CHANNEL_CAP } = jest.requireActual<
    typeof import('@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing')
  >('@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing');
  const answer = (q: RegExp) => FAQ_ITEMS.find((f) => q.test(f.question))!.answer;

  it('names the channels of every plan and the trial', () => {
    expect(answer(/more channels/)).toContain(
      `${pricing.STANDARD.channel}, ${pricing.PRO.channel} or ${pricing.ULTIMATE.channel}, depending on the plan; trials are capped at ${TRIAL_CHANNEL_CAP}`
    );
  });

  it('names the storage of every plan and the trial', () => {
    const storage = answer(/storage/);
    for (const part of [
      `${pricing.STANDARD.media_storage_gb} GB on Starter`,
      `${pricing.PRO.media_storage_gb} GB on Pro`,
      `${pricing.ULTIMATE.media_storage_gb} GB on Business`,
      `${TRIAL_LIMITS.media_storage_gb} GB during the free trial`,
    ]) {
      expect(storage).toContain(part);
    }
  });

  it("names the trial's limits", () => {
    const trial = answer(/trial work/);
    for (const part of [
      `up to ${TRIAL_CHANNEL_CAP} channels`,
      `up to ${TRIAL_LIMITS.posts_per_month} posts`,
      `${TRIAL_LIMITS.webhooks} webhook`,
      `${TRIAL_LIMITS.autoPostLimit} Auto Post feed`,
      `up to ${TRIAL_LIMITS.media_storage_gb} GB`,
    ]) {
      expect(trial).toContain(part);
    }
  });
});
