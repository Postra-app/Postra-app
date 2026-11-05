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
