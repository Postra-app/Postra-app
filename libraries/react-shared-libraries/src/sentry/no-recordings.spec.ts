import { readFileSync } from 'fs';
import { join } from 'path';

// Postra's monitoring records no sessions: what a customer does is not
// filmed, not even after an error. The browser client recorded a masked
// replay of every session that hit an error.
// Read as source: initializing Sentry in jsdom is not possible here.
const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

it.each(['initialize.sentry.client.ts', 'initialize.sentry.next.basic.ts', 'initialize.sentry.server.ts'])(
  '%s turns on no session replay',
  (file) => {
    const code = read(file).replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/replayIntegration|replayCanvasIntegration|replaysSessionSampleRate|replaysOnErrorSampleRate/);
  }
);
