import { NotificationService } from './notification.service';

// The screen reaches the push; e-mail and the in-app list are unchanged.
describe('inAppNotification passes the push screen on', () => {
  function service() {
    const push = { notifyOrg: jest.fn().mockResolvedValue(undefined) };
    const repo = { createNotification: jest.fn().mockResolvedValue(undefined) };
    const s = new NotificationService(repo as any, {} as any, {} as any, {} as any, push as any);
    return { s, push, repo };
  }

  it('sends the screen with the push', async () => {
    const { s, push, repo } = service();
    await s.inAppNotification('org1', 'Your AI video is ready', 'msg', false, false, 'success', 'media');
    expect(push.notifyOrg).toHaveBeenCalledWith('org1', 'Your AI video is ready', 'msg', 'success', 'media', undefined);
    expect(repo.createNotification).toHaveBeenCalledWith('org1', 'msg');
  });

  // A tap on "Your post has been published" opened the calendar; the push
  // now names the post, so the app can open it.
  it('sends the post with the push', async () => {
    const { s, push } = service();
    await s.inAppNotification('org1', 'Published', 'msg', true, true, 'success', undefined, 'post-1');
    expect(push.notifyOrg).toHaveBeenCalledWith('org1', 'Published', 'msg', 'success', undefined, 'post-1');
  });

  it('sends none when the caller gives none', async () => {
    const { s, push } = service();
    await s.inAppNotification('org1', 'Posted', 'msg');
    expect(push.notifyOrg).toHaveBeenCalledWith('org1', 'Posted', 'msg', 'success', undefined, undefined);
  });
});
