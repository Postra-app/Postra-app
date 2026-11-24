import { readFileSync } from 'fs';
import { join } from 'path';

// Errors thrown wholly by scripts that are not ours (a browser extension on
// the visitor's machine) are not sent to Sentry. The browser client tells
// ours from theirs by a key the build stamps on our modules; if the two
// spellings drift apart every frame looks foreign and every real error is
// dropped.
// Read as source: initializing Sentry in jsdom is not possible here.
const client = readFileSync(join(__dirname, 'initialize.sentry.client.ts'), 'utf8');
const build = readFileSync(
  join(__dirname, '../../../../apps/frontend/next.config.js'),
  'utf8'
);

it('the build marks our modules with the key the browser client filters by', () => {
  const key = client.match(/SENTRY_APPLICATION_KEY = '([^']+)'/)?.[1];
  expect(key).toBeTruthy();
  expect(build).toContain(`applicationKey: '${key}'`);
  expect(client).toMatch(/filterKeys: \[SENTRY_APPLICATION_KEY\]/);
});

it('drops an error only when none of its frames is ours', () => {
  expect(client).toContain(
    "behaviour: 'drop-error-if-exclusively-contains-third-party-frames'"
  );
});
