import { expect, test } from '@playwright/test';
import { anonymous } from '../helpers';

// Browsers send Content-Security-Policy violation reports without a session,
// in two formats. The endpoint always answers 204 and never errors, whatever
// arrives.
test('CSP reports are accepted in both formats, and junk does not break it', async () => {
  const api = await anonymous();
  const legacy = await api.post('/public/csp-report', {
    headers: { 'Content-Type': 'application/csp-report' },
    data: JSON.stringify({
      'csp-report': {
        'document-uri': 'https://app.postra.pl/launches',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js',
      },
    }),
  });
  expect(legacy.status()).toBe(204);

  const reporting = await api.post('/public/csp-report', {
    headers: { 'Content-Type': 'application/reports+json' },
    data: JSON.stringify([
      { type: 'csp-violation', url: 'https://app.postra.pl/media', body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.example/a.png' } },
    ]),
  });
  expect(reporting.status()).toBe(204);

  const junk = await api.post('/public/csp-report', {
    headers: { 'Content-Type': 'application/csp-report' },
    data: 'not json',
  });
  expect(junk.status()).toBe(204);
  await api.dispose();
});
