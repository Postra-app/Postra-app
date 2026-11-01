import 'reflect-metadata';
import { BlueskyProvider } from './bluesky.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { ThreadsProvider } from './threads.provider';
import { XProvider } from './x.provider';

// The Plugs page shows each plug's description and field labels as they are
// written on the provider, so they are customer text.
const plugs = [
  BlueskyProvider,
  LinkedinPageProvider,
  ThreadsProvider,
  XProvider,
].flatMap((provider) =>
  (Reflect.getMetadata('custom:plug', provider.prototype) || []).map(
    (plug: any) => ({ provider: provider.name, ...plug })
  )
);

describe('plug copy', () => {
  it('finds the plugs of every provider', () => {
    expect(plugs.length).toBe(7);
  });

  it.each(plugs.map((p: any) => [`${p.provider} ${p.identifier}`, p]))(
    '%s reads correctly',
    (_name, plug: any) => {
      // "you followers", "reached" for a rule that is still waiting.
      expect(plug.description).not.toMatch(/you followers|post reached/);
      // A plug checks a post 6, 12 and 18 hours after it goes out, not for a
      // week.
      expect(plug.description).not.toMatch(/week/i);
      expect(plug.runEveryMilliseconds * plug.totalRuns).toBeLessThanOrEqual(
        24 * 60 * 60 * 1000
      );
      const likes = plug.fields.find((f: any) => f.name === 'likesAmount');
      expect(likes.placeholder).toBe('Number of likes');
      // The reply plug's threshold triggers a reply, not a repost.
      expect(likes.description).toBe(
        plug.methodName === 'autoRepostPost'
          ? 'The number of likes that triggers the repost'
          : 'The number of likes that triggers the reply'
      );
    }
  );
});

describe('platform names', () => {
  // The Add Channel tile read "Tiktok".
  it('TikTok is spelt as TikTok spells it', async () => {
    const { TiktokProvider } = await import('./tiktok.provider');
    expect(new TiktokProvider().name).toBe('TikTok');
  });
});
