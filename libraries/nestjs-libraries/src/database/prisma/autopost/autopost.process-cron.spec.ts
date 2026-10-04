jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { AutopostService } from './autopost.service';

// Saving an autopost again (an edit, a repeated toggle) used to terminate the
// running feed and start a new run at once: a run caught mid-article posted it
// again with the old last URL (upstream d883bfa1). The running feed is kept.
describe('AutopostService.processCron', () => {
  const start = jest.fn().mockResolvedValue({});
  const terminateWorkflow = jest.fn().mockResolvedValue(true);
  const service = Object.create(AutopostService.prototype) as AutopostService;
  Object.assign(service, {
    _temporalService: { client: { getRawClient: () => ({ workflow: { start } }) }, terminateWorkflow },
  });

  beforeEach(() => jest.clearAllMocks());

  it('keeps a running feed instead of restarting it', async () => {
    await service.processCron(true, 'org-1', 'ap-1');
    expect(start).toHaveBeenCalledWith(
      'autoPostWorkflow',
      expect.objectContaining({ workflowId: 'autopost-ap-1', workflowIdConflictPolicy: 'USE_EXISTING' })
    );
    expect(terminateWorkflow).not.toHaveBeenCalled();
  });

  it('switching it off still stops the feed', async () => {
    await service.processCron(false, 'org-1', 'ap-1');
    expect(terminateWorkflow).toHaveBeenCalledWith('autopost-ap-1');
  });
});
