import { cameFromInvitePage } from './no.auth.integrations.controller';

// "Continue" on the invite page is what marks a browser as the invitee's.
// The address behind it, sent to someone as a link, did the same without the
// page that says whose organisation the channel is being connected to.
describe('following an invite', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.example.com/api';
  });
  afterAll(() => {
    process.env = env;
  });
  const from = (referer?: string) => ({ headers: referer ? { referer } : {} } as any);

  it('goes on from the invite page', () => {
    expect(cameFromInvitePage(from('https://app.example.com/connect/facebook/tok123'))).toBe(true);
  });

  it.each([
    ['a link in a mail or a chat', undefined],
    ['another site', 'https://evil.example/connect/facebook/tok123'],
    ['a look-alike host', 'https://app.example.com.evil.example/connect/facebook/x'],
    ['another page of the app, such as a post preview', 'https://app.example.com/p/cmh2x9k1z0001abcd'],
    ['the app with no page named', 'https://app.example.com/'],
    ['not an address', 'connect/facebook'],
  ])('does not go on from %s', (_what, referer) => {
    expect(cameFromInvitePage(from(referer))).toBe(false);
  });

  it('in development the app on another origin names only itself', () => {
    process.env.FRONTEND_URL = 'http://localhost:4200';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:3000';
    expect(cameFromInvitePage(from('http://localhost:4200/'))).toBe(true);
    expect(cameFromInvitePage(from('http://localhost:9999/'))).toBe(false);
  });
});
