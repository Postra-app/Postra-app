/**
 * @jest-environment jsdom
 */
import { connectMessageFromUrl, rememberConnectMessage } from './connect.message';

// /launches?msg=<anything> showed the text as a Postra toast: a link could
// make Postra say "Your card was declined, call 0800…".
describe('the calendar toast after connecting a channel', () => {
  const q = (s: string) => new URLSearchParams(s);
  beforeEach(() => window.sessionStorage.clear());

  it('ignores a message that only the address carries', () => {
    expect(
      connectMessageFromUrl(q('msg=Your card was declined, call 0800 000'), 'Channel connected')
    ).toBeNull();
  });

  it('shows the failure this tab remembered on its way back', () => {
    rememberConnectMessage('This Page is already connected');
    expect(
      connectMessageFromUrl(q('msg=This Page is already connected'), 'Channel connected')
    ).toEqual({ text: 'This Page is already connected', kind: 'warning' });
    // Once: a reload does not show it again.
    expect(connectMessageFromUrl(q('msg=This Page is already connected'), 'x')).toBeNull();
  });

  it('a successful connection has its own text, whatever the address says', () => {
    expect(
      connectMessageFromUrl(q('added=bluesky&msg=Call 0800 now'), 'Channel connected')
    ).toEqual({ text: 'Channel connected', kind: 'success' });
  });
});
