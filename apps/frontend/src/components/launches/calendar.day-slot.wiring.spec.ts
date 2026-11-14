import { readFileSync } from 'fs';
import { join } from 'path';

// Read as source: the calendar shell pulls SWR, the user context and drag and
// drop, and jsdom does not start it in this repo.
//
// The day view listed a channel once per post in a slot: two posts on one
// channel at the same minute showed its icon twice under one React key, and
// the duplicate list went into the new-post window. Its icons were keyed by
// platform, so two channels of one platform shared a key and one could be
// dropped (upstream 4eafd2102, d36b23c95).
const src = readFileSync(join(__dirname, 'calendar.tsx'), 'utf8');

describe('day view slot channels', () => {
  it('lists each channel of a slot once', () => {
    expect(src).toMatch(/integrations: uniqBy\(\s*option\.flatMap\(\(p\) => p\.integration\),\s*\(p: any\) => p\.id\s*\)/);
  });

  it('keys the channel icons by channel, not by platform', () => {
    expect(src).not.toMatch(/key=\{selectedIntegrations\.identifier\}/);
    expect(src).toMatch(/key=\{selectedIntegrations\.id\}/);
  });
});
