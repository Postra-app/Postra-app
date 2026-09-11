import { MobilePushService } from './mobile.push.service';

// Minimal fake of the prisma model surface the service touches.
function makeService() {
  const model = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
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

    it('REFUSES to claim a token registered to a different user (E2E-10-19)', async () => {
      const { service, model } = makeService();
      model.findUnique.mockResolvedValue({ userId: 'victim' });
      await service.registerToken('attacker', 'orgAttacker', TOKEN, 'ios');
      expect(model.upsert).not.toHaveBeenCalled();
    });
  });

  describe('removeToken', () => {
    it('deletes only rows owned by the caller (E2E-10-18)', async () => {
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
