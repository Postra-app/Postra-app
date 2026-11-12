import { APP_TABS, FAQ_ITEMS, MOBILE_APP } from './help.data';

// Help told customers things the app does not do:
// LinkedIn Pages is "Coming soon" for new connections (integration.manager.ts
// enabledProviders), so it has no analytics page and no plugs to offer; and a
// failed post's error shows on the red "!" of its calendar tile, not inside
// the opened post.
describe('Help text matches the app', () => {
  const tab = (id: string) => APP_TABS.find((t) => t.id === id)!;

  it('does not offer LinkedIn Pages analytics or plugs', () => {
    expect(tab('analytics').description).not.toContain('LinkedIn Pages');
    expect(tab('plugs').description).not.toContain('LinkedIn Pages');
  });

  it('says where a failed post shows its error', () => {
    const failed = FAQ_ITEMS.find((f) => f.question.startsWith('A post failed to publish'))!;
    expect(failed.answer).not.toContain('Open the post from the Calendar to see the error');
    expect(failed.answer).toContain('red !');
  });
});

// The customer has to learn the media storage and the
// phone's limits from Help, not from a refused upload.
describe('Help tells the limits', () => {
  it('Media names the storage of every plan and the trial', () => {
    const media = APP_TABS.find((t) => t.id === 'media')!.description;
    for (const part of ['10 GB on Starter', '25 GB on Pro', '100 GB on Business', '2 GB during the free trial']) {
      expect(media).toContain(part);
    }
  });

  it('the FAQ answers how much storage there is', () => {
    const faq = FAQ_ITEMS.find((f) => /storage/.test(f.question))!;
    expect(faq.answer).toContain('10 GB on Starter');
  });

  it('the mobile app section has the 10 minute / 1 GB video limit and what stays on the web', () => {
    expect(MOBILE_APP.limits.join(' ')).toContain('10 minutes and 1 GB');
    expect(MOBILE_APP.webOnly.join(' ')).toContain('Studio');
  });
});

// Help said "3, 6 or 12" channels while Business has 15: the numbers were
// typed in by hand. Every plan number in these answers is the plan's own.
describe('Help numbers are the plans', () => {
  const { pricing, TRIAL_LIMITS, TRIAL_CHANNEL_CAP } = jest.requireActual<
    typeof import('@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing')
  >('@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing');
  const answer = (q: RegExp) => FAQ_ITEMS.find((f) => q.test(f.question))!.answer;

  it('names the channels of every plan and the trial', () => {
    expect(answer(/more channels/)).toContain(
      `${pricing.STANDARD.channel}, ${pricing.PRO.channel} or ${pricing.ULTIMATE.channel}, depending on the plan; trials are capped at ${TRIAL_CHANNEL_CAP}`
    );
  });

  it('names the storage of every plan and the trial', () => {
    const storage = answer(/storage/);
    for (const part of [
      `${pricing.STANDARD.media_storage_gb} GB on Starter`,
      `${pricing.PRO.media_storage_gb} GB on Pro`,
      `${pricing.ULTIMATE.media_storage_gb} GB on Business`,
      `${TRIAL_LIMITS.media_storage_gb} GB during the free trial`,
    ]) {
      expect(storage).toContain(part);
    }
  });

  it("names the trial's limits", () => {
    const trial = answer(/trial work/);
    for (const part of [
      `up to ${TRIAL_CHANNEL_CAP} channels`,
      `up to ${TRIAL_LIMITS.posts_per_month} posts`,
      `${TRIAL_LIMITS.webhooks} webhook`,
      `${TRIAL_LIMITS.autoPostLimit} Auto Post feed`,
      `up to ${TRIAL_LIMITS.media_storage_gb} GB`,
    ]) {
      expect(trial).toContain(part);
    }
  });
});

// Help against the code: the guards below fail when
// Help names a platform customers cannot connect, a price that is not a plan's,
// or a button label the composer does not show.
describe('Help names only what the app has', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const fs = require('fs');
  const path = require('path');
  const help = require('./help.data');
  const en = require('@gitroom/react/translation/locales/en/translation.json');
  const { pricing, TRIAL_VIDEO_CLIPS } = jest.requireActual<
    typeof import('@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing')
  >('@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const social = path.join(
    __dirname,
    '../../../../../libraries/nestjs-libraries/src/integrations'
  );
  const manager = fs.readFileSync(path.join(social, 'integration.manager.ts'), 'utf8');
  const enabled = new Set<string>(
    [...manager.match(/const enabledProviders = new Set\(\[([\s\S]*?)\]\)/)![1]
      .replace(/\/\/.*$/gm, '')
      .matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  );
  // Every provider the code knows, with the name it shows.
  const providers: { identifier: string; name: string }[] = fs
    .readdirSync(path.join(social, 'social'))
    .filter((f: string) => f.endsWith('.provider.ts'))
    .map((f: string) => {
      const src = fs.readFileSync(path.join(social, 'social', f), 'utf8');
      return {
        identifier: src.match(/identifier = '([^']+)'/)?.[1] || '',
        name: src.match(/name = '([^']+)'/)?.[1] || '',
      };
    });
  const text = JSON.stringify([
    help.CHANNEL_GUIDES,
    help.APP_TABS,
    help.MOBILE_APP,
    help.STUDIO_GRAPHICS_TOOLS,
    help.STUDIO_VIDEO_TOOLS,
    help.SETTINGS_SECTIONS,
    help.FAQ_ITEMS,
    help.studioPhotoGuide((_k: string, f: string) => f),
  ]);

  it('has a channel guide for every enabled platform and none for the others', () => {
    // LinkedIn Page stays: its guide says new connections are coming soon,
    // and pages connected before keep working.
    const guides = help.CHANNEL_GUIDES.map((c: { identifier: string }) => c.identifier);
    expect(enabled.size).toBeGreaterThan(10);
    expect(guides.filter((g: string) => g !== 'linkedin-page').sort()).toEqual(
      [...enabled].sort()
    );
  });

  it('does not name a platform customers cannot connect', () => {
    const offered = new Set([...enabled, 'linkedin-page', 'mastodon-custom']);
    // "Medium" is also a retouch level in Studio - Photos.
    const names = providers
      .filter((p) => !offered.has(p.identifier) && p.name && p.name !== 'Medium')
      .flatMap((p) => [p.name, p.name.replace(/ My /, ' ')]);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect({ name, found: new RegExp(`\\b${name.replace('.', '\\.')}\\b`).test(text) }).toEqual({
        name,
        found: false,
      });
    }
  });

  it('every price it names is a plan price', () => {
    const prices = new Set(
      Object.values(pricing).flatMap((p) => [p.month_price, p.year_price])
    );
    for (const m of text.matchAll(/£(\d+)/g)) {
      expect(prices).toContain(Number(m[1]));
    }
  });

  it('the AI video credits are the plans', () => {
    const video = FAQ_ITEMS.find((f) => /AI videos/.test(f.question))!.answer;
    expect(video).toContain(
      `${pricing.STANDARD.generate_videos} a month on Starter, ${pricing.PRO.generate_videos} on Pro and ${pricing.ULTIMATE.generate_videos} on Business, and ${TRIAL_VIDEO_CLIPS} during the trial`
    );
  });

  it('the webhook allowance is the plans', () => {
    const webhooks = help.SETTINGS_SECTIONS.find(
      (s: { name: string }) => s.name === 'Webhooks'
    ).availability;
    expect(webhooks).toContain(
      `Starter ${pricing.STANDARD.webhooks}, Pro ${pricing.PRO.webhooks}`
    );
  });

  it('calls the thread button what the composer calls it', () => {
    // add.post.button.tsx: t('add_post', ...) for thread channels,
    // t('add_comment', ...) for comment channels such as Slack.
    expect(text).not.toContain('\\"Add post\\"');
    expect(text).toContain(`\\"${en.add_post}\\"`);
    expect(text).not.toContain('Add comment / post');
    expect(en.approved_apps).toBe('Approved apps');
    expect(text).not.toContain('Approved Apps');
  });

  it('first comments: names every channel that takes them, Slack included', () => {
    const comments = FAQ_ITEMS.find((f) => /first comments and threads/.test(f.question))!.answer;
    expect(comments).toContain('Slack');
    expect(comments).toContain('Pinterest');
  });

  it('the phone app: Google sign-in on Android, and which channels it connects', () => {
    expect(MOBILE_APP.intro).toContain('Android');
    expect(MOBILE_APP.intro).toContain('Google button on Android');
    const channels = MOBILE_APP.canDo.find((l) => l.startsWith('Channels'))!;
    for (const name of ['Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X', 'Threads']) {
      expect(channels).toContain(name);
    }
    expect(channels).not.toContain('most channels');
    // The phone app's fifth tab is Account (strings.ts 'tabs.account').
    expect(MOBILE_APP.canDo.some((l) => l.startsWith('Account:'))).toBe(true);
  });

  it('MCP: names the remote connectors the Developers tab offers', () => {
    // public.component.tsx: "Remote servers (ChatGPT, Claude)" sign in by OAuth.
    const mcp = FAQ_ITEMS.find((f) => /AI assistant \(MCP\)/.test(f.question))!.answer;
    expect(mcp).toContain('ChatGPT and Claude');
    expect(en.remote_servers ?? 'Remote servers (ChatGPT, Claude)').toContain('Remote servers');
  });
});
