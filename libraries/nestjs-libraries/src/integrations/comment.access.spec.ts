import { commentAccessForNow } from './comment.access';

// A TikTok channel's access for comments is renewed right before a comment.
// Written unconditionally, a renewal that read the old value could land after
// a newer one (another post of the channel, or the owner authorizing again)
// and put an already replaced token back.

const channel = () =>
  ({ id: 'int-1', organizationId: 'org-1', customInstanceDetails: 'at-start' } as any);

const store = (values: (string | null)[], count = 1) => {
  const getIntegrationById = jest.fn(async () => ({
    customInstanceDetails: values.length > 1 ? values.shift()! : values[0],
  }));
  const replaceCommentAccess = jest.fn(async () => ({ count }));
  return { getIntegrationById, replaceCommentAccess };
};

describe('commentAccessForNow', () => {
  it('does nothing for a provider without an access of its own', async () => {
    const s = store(['stored']);
    const integration = channel();
    await commentAccessForNow(s, {}, integration);
    expect(s.getIntegrationById).not.toHaveBeenCalled();
    expect(integration.customInstanceDetails).toBe('at-start');
  });

  it('uses what is stored now, not what the workflow started with', async () => {
    const s = store(['stored']);
    const integration = channel();
    const refreshCommentAccess = jest.fn(async (): Promise<undefined> => undefined);
    await commentAccessForNow(s, { refreshCommentAccess }, integration);
    expect(refreshCommentAccess.mock.calls[0][0].customInstanceDetails).toBe('stored');
    expect(integration.customInstanceDetails).toBe('stored');
    expect(s.replaceCommentAccess).not.toHaveBeenCalled();
  });

  it('writes a renewed access only over the value it read', async () => {
    const s = store(['stored']);
    const integration = channel();
    await commentAccessForNow(
      s,
      { refreshCommentAccess: async () => 'renewed' },
      integration
    );
    expect(s.replaceCommentAccess).toHaveBeenCalledWith('org-1', 'int-1', 'stored', 'renewed');
    expect(integration.customInstanceDetails).toBe('renewed');
  });

  it('takes the value someone else wrote meanwhile instead of putting its own over it', async () => {
    const s = store(['stored', 'written-by-another'], 0);
    const integration = channel();
    await commentAccessForNow(
      s,
      { refreshCommentAccess: async () => 'renewed' },
      integration
    );
    expect(integration.customInstanceDetails).toBe('written-by-another');
  });
});
