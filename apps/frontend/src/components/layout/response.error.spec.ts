import { refusalMessage } from './response.error';

const res = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('refusalMessage (E2E-08-36)', () => {
  it("shows the server's reason when it gave one", async () => {
    expect(await refusalMessage(res(400, { message: ['url must be a public HTTPS URL'] }), 'x')).toBe('url must be a public HTTPS URL');
    expect(await refusalMessage(res(404, { message: 'Set not found' }), 'x')).toBe('Set not found');
  });
  it('falls back when the body says nothing usable', async () => {
    expect(await refusalMessage(res(500, '<html>'), 'Not saved')).toBe('Not saved');
    expect(await refusalMessage(res(400, {}), 'Not saved')).toBe('Not saved');
  });
});
