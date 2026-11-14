import { readFileSync } from 'fs';
import { join } from 'path';

// Read as source: the channel list pulls SWR, drag and drop and the user
// context. A channel to reconnect had two click handlers, the row and the red
// "!" badge on its avatar, so one click asked the API for two authorization
// URLs and raced two redirects (upstream 3101654fe).
const src = readFileSync(join(__dirname, 'launches.component.tsx'), 'utf8');

it('one click on a channel to reconnect starts one reconnect', () => {
  expect(src.match(/refreshChannel\(integration\)/g)).toHaveLength(1);
  expect(src).toMatch(/integration\.refreshNeeded\s*\?\s*undefined\s*:\s*continueIntegration\(integration\)/);
});
