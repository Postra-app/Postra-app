import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { SlackDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/slack.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

export class SlackProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Slack has moderate API limits
  identifier = 'slack';
  name = 'Slack';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [
    'channels:read',
    'chat:write',
    'users:read',
    'groups:read',
    'channels:join',
    'chat:write.customize',
  ];
  dto = SlackDto;

  // Slack refuses a section block over 3,000 characters (invalid_blocks),
  // and the message goes out as one section.
  maxLength() {
    return 3000;
  }

  // Slack answers HTTP 200 with { ok: false, error } when a call fails, so
  // a failed post looked published. Every call goes through here: a dead
  // token asks for a reconnect, anything else fails the post with the reason.
  private async slack<T extends Record<string, any>>(
    method: string,
    accessToken: string,
    init: { body?: Record<string, unknown>; query?: Record<string, string> } = {}
  ): Promise<T> {
    const query = init.query ? `?${new URLSearchParams(init.query)}` : '';
    const res = await this.fetch(`https://slack.com/api/${method}${query}`, {
      method: init.body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const json = (await res.json()) as T & { ok: boolean; error?: string };
    if (json.ok) {
      return json;
    }
    const error = json.error || 'unknown_error';
    const body = JSON.stringify(init.body || init.query || {});
    if (SLACK_RECONNECT.has(error)) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify(json),
        body,
        'Slack no longer accepts Postra in this workspace. Reconnect the channel.'
      );
    }
    throw new BadBody(
      this.identifier,
      JSON.stringify(json),
      body,
      SLACK_ERRORS[error] || `Slack refused the message (${error}).`
    );
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 1000000,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }
  async generateAuthUrl() {
    const state = makeSecureId(6);

    return {
      url: `https://slack.com/oauth/v2/authorize?client_id=${
        process.env.SLACK_ID
      }&redirect_uri=${encodeURIComponent(
        `${
          process?.env?.FRONTEND_URL?.indexOf('https') === -1
            ? 'https://redirectmeto.com/'
            : ''
        }${process?.env?.FRONTEND_URL}/integrations/social/slack`
      )}&scope=channels:read,chat:write,users:read,groups:read,channels:join,chat:write.customize&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const access = await (
      await this.fetch(`https://slack.com/api/oauth.v2.access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.SLACK_ID!,
          client_secret: process.env.SLACK_SECRET!,
          code: params.code,
          redirect_uri: `${
            process?.env?.FRONTEND_URL?.indexOf('https') === -1
              ? 'https://redirectmeto.com/'
              : ''
          }${process?.env?.FRONTEND_URL}/integrations/social/slack${
            params.refresh ? `?refresh=${params.refresh}` : ''
          }`,
        }),
      })
    ).json();
    // A refused or expired code answers 200 { ok: false }: no token to save.
    if (!access.ok) {
      throw new Error(`Slack did not connect: ${access.error || 'unknown_error'}`);
    }
    const { access_token, team, bot_user_id, scope } = access;

    this.checkScopes(this.scopes, String(scope || '').split(','));

    const { user } = await this.slack<{ user: any }>('users.info', access_token, {
      query: { user: bot_user_id },
    });

    return {
      id: team.id,
      name: user.real_name,
      accessToken: access_token,
      refreshToken: 'null',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: user?.profile?.image_original || '',
      username: user.name,
    };
  }

  @Tool({
    description: 'Get list of channels',
    dataSchema: [],
  })
  async channels(accessToken: string, params: any, id: string) {
    // conversations.list pages at most 1,000 channels; follow the cursor so
    // a workspace with more still shows them all.
    const channels: { id: string; name: string }[] = [];
    let cursor = '';
    do {
      const page = await this.slack<{
        channels: { id: string; name: string }[];
        response_metadata?: { next_cursor?: string };
      }>('conversations.list', accessToken, {
        query: {
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
          limit: '1000',
          ...(cursor ? { cursor } : {}),
        },
      });
      channels.push(...page.channels.map((p) => ({ id: p.id, name: p.name })));
      cursor = page.response_metadata?.next_cursor || '';
    } while (cursor);
    return channels;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;

    // A public channel the bot is not in yet: join it. A private channel
    // cannot be joined; posting there then answers not_in_channel, which
    // tells the customer to invite the app.
    await this.slack('conversations.join', accessToken, {
      body: { channel },
    }).catch((err) => {
      if (err instanceof RefreshToken) throw err;
    });

    const { ts, channel: postedTo } = await this.slack<{
      ts: string;
      channel: string;
    }>('chat.postMessage', accessToken, {
      body: this.message(channel, firstPost, integration),
    });

    return [
      {
        id: firstPost.id,
        postId: ts,
        releaseURL: await this.permalink(accessToken, postedTo, ts),
        status: 'posted',
      },
    ];
  }

  private message(
    channel: string,
    post: PostDetails,
    integration: Integration,
    threadTs?: string
  ) {
    return {
      channel,
      username: integration.name,
      icon_url: integration.picture,
      // Shown in notifications and by clients that do not render blocks.
      text: post.message.slice(0, 3000),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: post.message,
          },
        },
        ...(post.media?.length
          ? post.media.map((m) => ({
              type: 'image',
              image_url: m.path,
              alt_text: m.alt || 'Image',
            }))
          : []),
      ],
    };
  }

  // The link is a convenience: a published message without it is still
  // published.
  private async permalink(accessToken: string, channel: string, ts: string) {
    try {
      const { permalink } = await this.slack<{ permalink: string }>(
        'chat.getPermalink',
        accessToken,
        { query: { channel, message_ts: ts } }
      );
      return permalink || '';
    } catch {
      return '';
    }
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const channel = commentPost.settings.channel;
    const threadTs = lastCommentId || postId;

    const { ts, channel: postedTo } = await this.slack<{
      ts: string;
      channel: string;
    }>('chat.postMessage', accessToken, {
      body: this.message(channel, commentPost, integration, threadTs),
    });

    return [
      {
        id: commentPost.id,
        postId: ts,
        releaseURL: await this.permalink(accessToken, postedTo, ts),
        status: 'posted',
      },
    ];
  }

  async changeProfilePicture(id: string, accessToken: string, url: string) {
    return {
      url,
    };
  }

  async changeNickname(id: string, accessToken: string, name: string) {
    return {
      name,
    };
  }
}

// Errors after which only a new authorisation helps.
const SLACK_RECONNECT = new Set([
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'no_permission',
  'missing_scope',
  'team_access_not_granted',
]);

// What the customer reads when Slack refuses a message.
const SLACK_ERRORS: Record<string, string> = {
  not_in_channel:
    'The Postra app is not in this Slack channel. In a private channel, invite it first with /invite @Postra.',
  channel_not_found:
    'This Slack channel no longer exists or Postra cannot see it. Pick another channel.',
  is_archived: 'This Slack channel is archived. Pick another channel.',
  msg_too_long: 'The message is too long for Slack (3,000 characters at most).',
  no_text: 'The message is empty.',
  invalid_blocks:
    'Slack could not show this message: check its length (3,000 characters at most) and the images.',
  restricted_action:
    'The workspace settings do not allow apps to post in this channel.',
};
