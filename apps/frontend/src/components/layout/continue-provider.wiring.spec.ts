import { readFileSync } from 'fs';
import { join } from 'path';

// Read as source: the picker pulls SWR, the modal stack and the provider
// list. The "finish this channel" window left out the pages that were
// already connected; a login whose only page was connected got a title over
// an empty grid and nothing to press (upstream #2071). The backend renews the
// connected channel when its page is chosen again.
const modal = readFileSync(join(__dirname, 'continue.provider.tsx'), 'utf8');
const picker = readFileSync(
  join(__dirname, '../new-launch/providers/continue-provider/with-continue-provider.tsx'),
  'utf8'
);

it('the picker lists every page the login returned', () => {
  expect(picker).not.toMatch(/existingId/);
  expect(picker).not.toMatch(/\.filter\(/);
  expect(modal).not.toMatch(/existingId|integrations\/list'\s*,\s*load/);
});
