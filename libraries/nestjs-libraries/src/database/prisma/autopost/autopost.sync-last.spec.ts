jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { AutopostService } from './autopost.service';

// "Should we sync the current last post?" had no effect: the form saved the
// newest article as already seen on "No", and the first run did the same on
// "Yes", so the newest article was never posted either way (docs P3 check,
// 2026-10-09). "Yes" now posts it on the first run; "No" waits for the next.
describe('the first run of a new Auto Post feed', () => {
  const run = async (syncLast: boolean) => {
    const service = Object.create(AutopostService.prototype) as any;
    const updateUrl = jest.fn();
    service._autopostsRepository = {
      getAutopost: async () => ({ id: 'ap-1', active: true, lastUrl: '', syncLast, url: 'https://blog.example/feed', organizationId: 'org-1', integrations: '[]' }),
      updateUrl,
    };
    service.loadXML = async () => ({ success: true, url: 'https://blog.example/newest', date: new Date().toISOString(), description: 'Newest' });
    const getIntegrationsList = jest.fn(async () => []);
    service._integrationService = { getIntegrationsList };
    await service.startAutopost('ap-1');
    return { updateUrl, posted: getIntegrationsList.mock.calls.length > 0 };
  };

  it('posts the newest article when asked to sync it', async () => {
    const { updateUrl, posted } = await run(true);
    expect(posted).toBe(true);
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it('only remembers it when not', async () => {
    const { updateUrl, posted } = await run(false);
    expect(posted).toBe(false);
    expect(updateUrl).toHaveBeenCalledWith('ap-1', 'https://blog.example/newest');
  });
});
