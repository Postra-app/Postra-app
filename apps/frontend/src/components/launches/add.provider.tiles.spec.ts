import { visibleProviderTiles } from './add.provider.tiles';

// Add Channel: customers see only the platforms they can connect, a super
// admin every tile ("Soon" included), the preview organisation (a platform
// reviewer's login) the offered ones plus Google Business Profile.
const social = [
  { identifier: 'lemmy', enabled: false },
  { identifier: 'bluesky', enabled: true },
  { identifier: 'gmb', enabled: false, preview: true },
  { identifier: 'linkedin-page', enabled: false },
  { identifier: 'wordpress', enabled: true },
];
const ids = (list: { identifier: string }[]) => list.map((p) => p.identifier);

describe('Add Channel tiles', () => {
  it('a customer sees only the platforms on offer, no "Soon" tile', () => {
    expect(ids(visibleProviderTiles(social, { isSuperAdmin: false, previewChannels: false }))).toEqual([
      'bluesky',
      'wordpress',
    ]);
    expect(ids(visibleProviderTiles(social, undefined))).toEqual(['bluesky', 'wordpress']);
  });

  it('a super admin sees every tile, the offered ones first', () => {
    expect(ids(visibleProviderTiles(social, { isSuperAdmin: true, previewChannels: true }))).toEqual([
      'bluesky',
      'wordpress',
      'lemmy',
      'gmb',
      'linkedin-page',
    ]);
  });

  it('the preview organisation sees the offered platforms and the preview one only', () => {
    expect(ids(visibleProviderTiles(social, { isSuperAdmin: false, previewChannels: true }))).toEqual([
      'bluesky',
      'wordpress',
      'gmb',
    ]);
    // Not through an invite link: the backend refuses a preview platform there.
    expect(
      ids(visibleProviderTiles(social, { isSuperAdmin: false, previewChannels: true }, true))
    ).toEqual(['bluesky', 'wordpress']);
  });

  it('keeps a hidden platform out unless the viewer has the preview', () => {
    const hidden = [{ identifier: 'moltbook', enabled: false, preview: true, adminOnly: true }];
    expect(ids(visibleProviderTiles(hidden, { previewChannels: false }))).toEqual([]);
    expect(ids(visibleProviderTiles(hidden, { previewChannels: true }))).toEqual(['moltbook']);
  });
});
