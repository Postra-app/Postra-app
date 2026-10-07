import { ResendProvider } from './resend.provider';

// The SDK reads `replyTo` and sends `reply_to`; since resend 6 a `reply_to`
// passed in is dropped without a word, so replies to a problem report or a
// cancellation notice went to the system sender instead of the customer.
describe('ResendProvider', () => {
  it('sends the reply-to address', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    try {
      await new ResendProvider().sendEmail(
        'admin@example.com',
        'Problem report',
        '<p>Hi</p>',
        'Postra',
        'no-reply@example.com',
        'customer@example.com'
      );
      expect(fetchSpy).toHaveBeenCalled();
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(body.reply_to).toBe('customer@example.com');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
