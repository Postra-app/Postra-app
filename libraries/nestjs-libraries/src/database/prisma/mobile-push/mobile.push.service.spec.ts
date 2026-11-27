import { MobilePushService } from './mobile.push.service';

// Minimal fake of the prisma model surface the service touches.
function makeService() {
  const model = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
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
      model.findUnique.mockResolvedValue(null);
      await service.registerToken('userA', 'orgA', TOKEN, 'ios');
      expect(model.upsert).toHaveBeenCalledTimes(1);
    });

    it('refreshes a token the SAME user already owns', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'userA' });
      await service.registerToken('userA', 'orgA2', TOKEN, 'android');
      expect(model.upsert).toHaveBeenCalledTimes(1);
      // The update branch must never rewrite userId.
      const arg = model.upsert.mock.calls[0][0];
      expect(arg.update).not.toHaveProperty('userId');
    });

    it('REFUSES to claim a token registered to a different user', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'victim' });
      await service.registerToken('attacker', 'orgAttacker', TOKEN, 'ios');
      expect(model.upsert).not.toHaveBeenCalled();
    });
  });

  // E2E-11-365: a session that ended without signing out left the token with
  // the previous account; the next person on the phone got no notifications
  // and the previous account's kept arriving there.
  describe('the device secret', () => {
    const SECRET = 'a'.repeat(64);
    const { createHash } = jest.requireActual('crypto');
    const HASH = createHash('sha256').update(SECRET).digest('hex');

    it('stores only the hash of the secret with a new token', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue(null);
      await service.registerToken('userA', 'orgA', TOKEN, 'ios', SECRET);
      const arg = model.upsert.mock.calls[0][0];
      expect(arg.create.deviceSecretHash).toBe(HASH);
      expect(JSON.stringify(arg)).not.toContain(SECRET);
    });

    it('moves the token to the next account signed in on the same device', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'previous', deviceSecretHash: HASH });
      await service.registerToken('next', 'orgN', TOKEN, 'ios', SECRET);
      expect(model.update).toHaveBeenCalledWith({
        where: { token: TOKEN },
        data: { userId: 'next', organizationId: 'orgN', platform: 'ios' },
      });
    });

    it('a leaked token without the secret, or with another, still moves nowhere', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'victim', deviceSecretHash: HASH });
      await service.registerToken('attacker', 'orgX', TOKEN, 'ios');
      await service.registerToken('attacker', 'orgX', TOKEN, 'ios', 'b'.repeat(64));
      expect(model.update).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
    });

    it('a token from an older build (no hash) is never moved, even with a secret', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'victim', deviceSecretHash: null });
      await service.registerToken('attacker', 'orgX', TOKEN, 'ios', SECRET);
      expect(model.update).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
    });

    it('its owner gives an older token its secret the first time', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'userA', deviceSecretHash: null });
      await service.registerToken('userA', 'orgA', TOKEN, 'ios', SECRET);
      expect(model.upsert.mock.calls[0][0].update.deviceSecretHash).toBe(HASH);
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
