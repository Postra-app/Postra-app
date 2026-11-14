jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
import 'reflect-metadata';

import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';

// A refused authorization code came back without a token; the long-lived
// exchange then ran with access_token=undefined and the customer read "Not
// enough scopes", with nothing logged (upstream 21a57a2bf).
describe('Instagram (no Facebook Page) code exchange', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it("says what Instagram said and does not go on without a token", async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        error_type: 'OAuthException',
        code: 400,
        error_message: 'This authorization code has been used',
      }),
    });
    await expect(
      new InstagramStandaloneProvider().authenticate({ code: 'c', codeVerifier: 'v' } as any)
    ).rejects.toThrow('This authorization code has been used');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
