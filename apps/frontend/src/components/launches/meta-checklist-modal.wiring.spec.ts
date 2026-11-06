import { readFileSync } from 'fs';
import { join } from 'path';

// Read as source: the add-channel modal pulls SWR, the user context and the
// modal manager, and jsdom does not start in this repo.
//
// The modal card is `w-fit`; the checklist's intro is one long paragraph, so
// without a cap the card grew to the width of the window (measured on a
// 1468 px window: card x=0, width 1468, rounded corners cut at the edge).
const src = readFileSync(join(__dirname, 'add.provider.component.tsx'), 'utf8');

describe('Meta checklist before connecting', () => {
  it('opens in a modal with a width cap', () => {
    const open = src.indexOf('title: t(checklist.title.key');
    expect(open).toBeGreaterThan(-1);
    const call = src.slice(open, src.indexOf('children:', open));
    expect(call).toMatch(/maxSize:\s*\d+/);
  });
});
