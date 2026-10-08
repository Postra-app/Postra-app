import { APP_TABS, FAQ_ITEMS } from './help.data';

// Help told customers things the app does not do (docs P2 check, 2026-10-09):
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
