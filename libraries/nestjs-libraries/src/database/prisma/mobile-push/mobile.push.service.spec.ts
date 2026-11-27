import { MobilePushService } from './mobile.push.service';

// Minimal fake of the prisma model surface the service touches.
function makeService() {
  const model = {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  };
  const repo = { model: { mobilePushToken: model } } as any;
  return { service: new MobilePushService(repo), model };
}

describe('MobilePushService authorization', () => {
  const TOKEN = 'ExponentPushToken[abc]';

  describe('registerToken', () => {
    it('registers a fresh, unclaimed token for the caller', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValue({ count: 0 });
      await service.registerToken('userA', 'orgA', TOKEN, 'ios');
      expect(model.create).toHaveBeenCalledWith({
        data: { userId: 'userA', token: TOKEN, organizationId: 'orgA', platform: 'ios', deviceSecretHash: null },
      });
    });

    it('refreshes a token the SAME user already owns, never moving it', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValueOnce({ count: 1 });
      await service.registerToken('userA', 'orgA2', TOKEN, 'android');
      expect(model.updateMany).toHaveBeenCalledWith({
        where: { token: TOKEN, userId: 'userA' },
        data: { organizationId: 'orgA2', platform: 'android' },
      });
      expect(model.create).not.toHaveBeenCalled();
    });

    it('REFUSES to claim a token registered to a different user', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValue({ count: 0 });
      model.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.registerToken('attacker', 'orgAttacker', TOKEN, 'ios')).resolves.toBeUndefined();
      // No write that could move it: only the caller-scoped refresh was tried.
      expect(model.updateMany).toHaveBeenCalledTimes(1);
      expect(model.updateMany.mock.calls[0][0].where).toEqual({ token: TOKEN, userId: 'attacker' });
    });
  });

  // A session that ended without signing out left the token with the
  // previous account; the next person on the phone got no notifications and
  // the previous account's kept arriving there.
  describe('the device secret', () => {
    const SECRET = 'a'.repeat(64);
    const { createHash } = jest.requireActual('crypto');
    const HASH = createHash('sha256').update(SECRET).digest('hex');

    it('stores only the hash of the secret with a new token', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValue({ count: 0 });
      await service.registerToken('userA', 'orgA', TOKEN, 'ios', SECRET);
      const arg = model.create.mock.calls[0][0];
      expect(arg.data.deviceSecretHash).toBe(HASH);
      expect(JSON.stringify(arg)).not.toContain(SECRET);
    });

    it('moves the token to the next account only where the hash matches, in one statement', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      await service.registerToken('next', 'orgN', TOKEN, 'ios', SECRET);
      expect(model.updateMany).toHaveBeenLastCalledWith({
        where: { token: TOKEN, deviceSecretHash: HASH, NOT: { userId: 'next' } },
        data: { userId: 'next', organizationId: 'orgN', platform: 'ios' },
      });
      expect(model.create).not.toHaveBeenCalled();
    });

    it('a leaked token without the secret, or with another, moves nowhere', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValue({ count: 0 });
      model.create.mockRejectedValue({ code: 'P2002' });
      await expect(service.registerToken('attacker', 'orgX', TOKEN, 'ios')).resolves.toBeUndefined();
      await expect(service.registerToken('attacker', 'orgX', TOKEN, 'ios', 'b'.repeat(64))).resolves.toBeUndefined();
      for (const [arg] of model.updateMany.mock.calls) {
        expect(arg.where.userId === 'attacker' || arg.where.deviceSecretHash !== HASH).toBe(true);
      }
    });

    // The previous owner's refresh, racing the hand-over, wrote
    // its organisation onto the token after it had moved.
    it('a refresh by the previous owner after the token moved writes nothing onto it', async () => {
      const { service, model } = makeService();
      // The token is the next account's now: the previous owner's refresh is
      // scoped to its own rows and matches none, and without the device
      // secret nothing moves; the insert meets the existing token and stops.
      model.updateMany.mockResolvedValue({ count: 0 });
      model.create.mockRejectedValue({ code: 'P2002' });
      await service.registerToken('previous', 'orgPrev', TOKEN, 'ios');
      expect(model.updateMany.mock.calls[0][0].where).toEqual({ token: TOKEN, userId: 'previous' });
      expect(model.create).toHaveBeenCalledTimes(1);
    });

    it('its owner gives an older token its secret the first time', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValue({ count: 1 });
      await service.registerToken('userA', 'orgA', TOKEN, 'ios', SECRET);
      expect(model.updateMany).toHaveBeenLastCalledWith({
        where: { token: TOKEN, userId: 'userA', deviceSecretHash: null },
        data: { deviceSecretHash: HASH },
      });
    });

    it('other database errors are not swallowed', async () => {
      const { service, model } = makeService();
      model.updateMany.mockResolvedValue({ count: 0 });
      model.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.registerToken('userA', 'orgA', TOKEN, 'ios')).rejects.toThrow('connection lost');
    });
  });

  describe('removeToken', () => {
    it('deletes only rows owned by the caller', async () => {
      const { service, model } = makeService();
      await service.removeToken(TOKEN, 'userA');
      expect(model.deleteMany).toHaveBeenCalledWith({
        where: { token: TOKEN, userId: 'userA' },
      });
    });

    it('does nothing without a userId', async () => {
      const { service, model } = makeService();
      await service.removeToken(TOKEN, '');
      expect(model.deleteMany).not.toHaveBeenCalled();
    });

    it('does nothing without a token', async () => {
      const { service, model } = makeService();
      await service.removeToken('', 'userA');
      expect(model.deleteMany).not.toHaveBeenCalled();
    });
  });
});

describe('notifyOrg recipients', () => {
  // Removing a member left their phone registered for the organisation, so
  // every publication and failure still reached it.
  it('pushes only to active, unsuspended members of the organisation', async () => {
    const { service, model } = makeService();
    model.findMany.mockResolvedValue([]);
    await service.notifyOrg('orgA', 'title', 'body');
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'orgA',
          user: {
            suspendedAt: null,
            organizations: { some: { organizationId: 'orgA', disabled: false } },
          },
        },
      })
    );
  });
});

// A tap on "Your AI video is ready" opened the calendar; the clip is in Media.
describe('notifyOrg tells the app which screen a tap opens', () => {
  async function sent(screen?: 'media' | 'channels', postId?: string) {
    const { service, model } = makeService();
    model.findMany.mockResolvedValue([{ token: 'ExponentPushToken[a]' }]);
    const send = jest.spyOn(service as any, 'send').mockResolvedValue(undefined);
    await service.notifyOrg('orgA', 'title', 'body', 'success', screen, postId);
    return (send.mock.calls[0][0] as any[])[0].data;
  }

  it('adds the post when one is given, so a tap can open it', async () => {
    // With the organisation: a phone that has another one chosen cannot
    // read the post and must not try.
    expect(await sent(undefined, 'post-1')).toEqual({ type: 'success', postId: 'post-1', orgId: 'orgA' });
  });

  it('adds the screen when one is given', async () => {
    expect(await sent('media')).toEqual({ type: 'success', screen: 'media' });
    expect(await sent('channels')).toEqual({ type: 'success', screen: 'channels' });
  });

  it('leaves the data as before when none is given, so older apps see no change', async () => {
    expect(await sent()).toEqual({ type: 'success' });
  });
});

// Without a channelId every push on Android landed in Expo's fallback channel,
// so turning off "Postra" in the system settings silenced nothing.
describe('notifyOrg names the Android channel', () => {
  it('sends channelId postra-alerts, the channel the app creates', async () => {
    const { service, model } = makeService();
    model.findMany.mockResolvedValue([{ token: 'ExponentPushToken[a]' }]);
    const send = jest.spyOn(service as any, 'send').mockResolvedValue(undefined);
    await service.notifyOrg('orgA', 'title', 'body');
    expect((send.mock.calls[0][0] as any[])[0]).toMatchObject({
      channelId: 'postra-alerts',
      priority: 'high',
    });
  });
});
