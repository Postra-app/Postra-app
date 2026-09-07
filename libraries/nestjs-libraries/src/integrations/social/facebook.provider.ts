import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import {
  ProcessingTimeout,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { Integration } from '@prisma/client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { timer } from '@gitroom/helpers/utils/timer';
import { percentageChangeFromSeries } from '@gitroom/nestjs-libraries/integrations/social/analytics.utils';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

@Rules(
  "Facebook posts can be text only, or include photos or a video. If it's a story, it must have at least one attachment (photo or video), and each media is published as a separate story."
)
export class FacebookProvider extends SocialAbstract implements SocialProvider {
  identifier = 'facebook';
  name = 'Facebook Page';
  isBetweenSteps = true;
  scopes = [
    'pages_show_list',
    'business_management',
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement',
    'read_insights',
  ];
  // pages_manage_engagement (first comment) reached Advanced access when its
  // mini App Review was approved on 2026-09-07, so Meta now grants it to every
  // user rather than only to accounts holding a role in the app.
  //
  // It stays asked-not-required anyway, for the same reason instagram.provider
  // spells out: requiring a scope is exactly what broke connect for every
  // external user in #188, and Meta can move a permission back to Standard
  // without warning. Asked-not-required degrades to "the feature hides itself
  // on that channel"; required degrades to "nobody can connect at all".
  //
  // Channels authorised before the approval keep the scope set they were granted
  // at the time — an approval does not reach back into an existing token — so
  // they show no comment button until they are reconnected. That is what the
  // help text tells users, and what backfill-granted-scopes reports.
  optionalScopes = ['pages_manage_engagement'];
  commentScope = 'pages_manage_engagement';
  override maxConcurrentJob = 500; // Facebook has reasonable rate limits
  editor = 'normal' as const;
  maxLength() {
    return 63206;
  }
  dto = FacebookDto;

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (settings?.post_type === 'story') {
      if (!firstPost?.length) {
        return 'Story should have at least one media';
      }
    }
    return true;
  }

  override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Access token validation errors - require re-authentication
    if (body.indexOf('Error validating access token') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Please re-authenticate your Facebook account',
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token has been revoked, please re-authenticate',
      };
    }

    if (body.indexOf('1366046') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Photos should be smaller than 4 MB and saved as JPG, PNG',
      };
    }

    if (body.indexOf('1390008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You are posting too fast, please slow down',
      };
    }

    // Content policy violations
    if (body.indexOf('1346003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content flagged as abusive by Facebook',
      };
    }

    // Identity verification required — token stays valid, publishing resumes
    // automatically once the user verifies identity in the Facebook app.
    // Do NOT return 'refresh-token' here; reconnecting is not needed.
    if (
      body.indexOf('Confirm your identity') > -1 ||
      body.indexOf('confirm your identity') > -1
    ) {
      return {
        type: 'bad-body' as const,
        value:
          'Facebook requires identity verification before publishing to this Page. Open the Facebook app on your phone, complete the verification, and posts will resume automatically — no reconnection needed.',
      };
    }

    if (body.indexOf('1404006') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          "We couldn't post your comment, A security check in facebook required to proceed.",
      };
    }

    if (body.indexOf('2069019') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid file',
      }
    }

    if (body.indexOf('1404102') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content violates Facebook Community Standards',
      };
    }

    // Permission errors
    if (body.indexOf('1404078') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Page publishing authorization required, please re-authenticate',
      };
    }

    if (body.indexOf('1366051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'These photos were already posted.',
      };
    }

    if (body.indexOf('1609008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Cannot post Facebook.com links',
      };
    }

    // Parameter validation errors
    if (body.indexOf('2061006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid URL format in post content',
      };
    }

    if (body.indexOf('1349125') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid content format',
      };
    }

    if (body.indexOf('1404112') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'For security reasons, your account has limited access to the site for a few days',
      };
    }

    if (body.indexOf('Name parameter too long') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Post content is too long',
      };
    }

    // Service errors - checking specific subcodes first
    if (body.indexOf('1363047') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('1609010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('4854002') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Confirm your identity before you can publish as this Page. Open the Facebook app on your phone and follow the instructions',
      };
    }
    if (body.indexOf('(#100) No permission to publish the video') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook return: No permission to publish the video',
      };
    }
    // Match the token-expiry error as a STRUCTURED code, not a loose substring.
    // The old `body.indexOf('490')` matched anywhere — inside an fbtrace_id, a
    // post/video id or a timestamp — so an unrelated error disconnected a
    // healthy Page and emailed the user to reconnect. Facebook's real
    // expired/invalid-token error is code 190 (same code checkToken() uses);
    // the common message form is already handled at the top of this function.
    if (body.indexOf('"code":190') > -1 || body.indexOf('"code": 190') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token expired, please re-authenticate',
      };
    }

    if (status === 401) {
      return {
        type: 'bad-body' as const,
        value:
          'An unknown error occurred, please try again later or contact support',
      };
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/facebook`
        )}` +
        `&state=${state}` +
        `&scope=${this.scopes.join(',')}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/facebook${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}&fields=access_token,expires_in`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(
      this.scopes.filter((scope) => !this.optionalScopes.includes(scope)),
      permissions
    );

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
      // Page tokens inherit the user's grants, and the page is picked from this
      // same authorization, so the user-level list describes the channel too.
      grantedScopes: permissions,
    };
  }

  async pages(accessToken: string) {
    const seenIds = new Set<string>();
    const allPages: any[] = [];

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const response = await (await fetch(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenIds.has(page.id)) {
              seenIds.add(page.id);
              allPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    await fetchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
    );

    // Also fetch pages via Business Manager API to discover pages
    // not selected during the OAuth page selection step
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }

            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    return allPages;
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const pageId = data.page;
    const fields = 'id,username,name,access_token,picture.type(large)';

    const searchPaginated = async (startUrl: string) => {
      let url: string | undefined = startUrl;
      while (url) {
        const response = await (await fetch(url)).json();
        if (response.data) {
          const page = response.data.find(
            (p: any) => String(p.id) === String(pageId)
          );
          if (page) {
            return {
              id: page.id,
              name: page.name,
              access_token: page.access_token,
              picture: page.picture?.data?.url || '',
              username: page.username,
            };
          }
        }
        url = response.paging?.next;
      }
      return null;
    };

    // 1. Check /me/accounts
    const fromAccounts = await searchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=${fields}&limit=100&access_token=${accessToken}`
    );
    if (fromAccounts) return fromAccounts;

    // 2. Check Business Manager owned_pages and client_pages
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              const fromOwned = await searchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=${fields}&limit=100&access_token=${accessToken}`
              );
              if (fromOwned) return fromOwned;
            } catch {
              // Continue with other businesses
            }

            try {
              const fromClient = await searchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=${fields}&limit=100&access_token=${accessToken}`
              );
              if (fromClient) return fromClient;
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    throw new Error('Page not found in your accounts');
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const isStory = firstPost?.settings?.post_type === 'story';

    let finalId = '';
    let finalUrl = '';
    if (isStory) {
      let lastPostId = '';
      for (const media of firstPost?.media || []) {
        const isVideoStory = hasExtension(media.path, 'mp4');
        if (isVideoStory) {
          const { video_id, upload_url } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/video_stories?upload_phase=start&access_token=${accessToken}`,
              {
                method: 'POST',
              },
              'start video story upload'
            )
          ).json();

          await this.fetch(
            upload_url,
            {
              method: 'POST',
              headers: {
                Authorization: `OAuth ${accessToken}`,
                file_url: media.path,
              },
            },
            'upload video story'
          );

          let videoStatus = 'in_progress';
          // Facebook settles on `upload_complete` as often as on `ready`, and
          // waiting only for `ready` kept the poll spinning until the cap below
          // and failed the story on a video that had actually uploaded fine.
          const isUploaded = (s: string) =>
            s === 'ready' || s === 'upload_complete';
          // Capped under the 10-min activity budget (H1): an unbounded poll
          // used to blow the activity timeout and the retry re-published.
          let storyAttempts = 0;
          while (!isUploaded(videoStatus)) {
            if (storyAttempts++ >= 42) {
              throw new ProcessingTimeout('facebook');
            }
            const { status } = await (
              await this.fetch(
                `https://graph.facebook.com/v20.0/${video_id}?fields=status&access_token=${accessToken}`,
                undefined,
                '',
                0,
                true
              )
            ).json();
            videoStatus = status?.video_status || 'in_progress';
            if (videoStatus === 'error') {
              throw new Error('Video processing failed');
            }
            if (!isUploaded(videoStatus)) {
              await timer(10000);
            }
          }

          const { post_id: storyPostId } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/video_stories?upload_phase=finish&video_id=${video_id}&access_token=${accessToken}`,
              {
                method: 'POST',
              },
              'finish video story upload'
            )
          ).json();

          lastPostId = storyPostId;
        } else {
          const { id: photoId } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  url: media.path,
                  published: false,
                }),
              },
              'upload photo story'
            )
          ).json();

          const { post_id: storyPostId } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/photo_stories?photo_id=${photoId}&access_token=${accessToken}`,
              {
                method: 'POST',
              },
              'publish photo story'
            )
          ).json();

          lastPostId = storyPostId;
        }
      }

      finalId = lastPostId;
      finalUrl = `https://www.facebook.com/stories/${lastPostId}`;
    } else if (hasExtension(firstPost?.media?.[0]?.path, 'mp4')) {
      const {
        id: videoId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/videos?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_url: firstPost?.media?.[0]?.path!,
              description: firstPost.message,
              published: true,
            }),
          },
          'upload mp4'
        )
      ).json();

      finalUrl = 'https://www.facebook.com/reel/' + videoId;
      finalId = videoId;
    } else {
      const uploadPhotos = !firstPost?.media?.length
        ? []
        : await Promise.all(
            firstPost.media.map(async (media) => {
              const { id: photoId } = await (
                await this.fetch(
                  `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      url: media.path,
                      published: false,
                    }),
                  },
                  'upload images slides'
                )
              ).json();

              return { media_fbid: photoId };
            })
          );

      const {
        id: postId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/feed?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(uploadPhotos?.length ? { attached_media: uploadPhotos } : {}),
              ...(firstPost?.settings?.url
                ? { link: firstPost.settings.url }
                : {}),
              message: firstPost.message,
              published: true,
            }),
          },
          'finalize upload'
        )
      ).json();

      finalUrl = permalink_url;
      finalId = postId;
    }

    return [
      {
        id: firstPost.id,
        postId: finalId,
        releaseURL: finalUrl,
        status: 'success',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${replyToId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...(commentPost.media?.length
              ? { attachment_url: commentPost.media[0].path }
              : {}),
            message: commentPost.message,
          }),
        },
        'add comment'
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: data.id,
        releaseURL: data.permalink_url,
        status: 'success',
      },
    ];
  }

  async checkToken(accessToken: string, internalId: string): Promise<boolean> {
    try {
      const { error } = await (
        await fetch(
          `https://graph.facebook.com/v20.0/${internalId}?fields=id&access_token=${accessToken}`
        )
      ).json();
      // 190 = access token expired/revoked (e.g. user removed the app). Any
      // other error (rate limit, network) is transient — keep the channel.
      return error?.code !== 190;
    } catch {
      return true;
    }
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    // Meta deprecates Page Insights metrics on a rolling schedule, and a SINGLE
    // unsupported metric makes the WHOLE /insights call fail (returns []). The
    // old code only dropped page_video_views on retry, so once any *core*
    // metric got deprecated the entire analytics panel went empty. Instead:
    // try them all in one request (fast path) and, if Meta rejects the batch,
    // fall back to querying each metric on its own and keep whatever still
    // works — one dead metric no longer wipes out the rest.
    //
    // Reach/impression metrics (page_impressions_unique, page_posts_impressions_unique,
    // page_video_views) were removed by Meta on 2026-06-15 and now return an "invalid
    // metric" error. They are replaced by the Media Views metrics, which require
    // Graph API v23.0+:
    //   - page_total_media_view_unique: total unique views on the page's media (reach)
    //   - page_media_view: total media views, split into paid/organic
    const allMetrics = [
      'page_total_media_view_unique',
      'page_media_view',
      'page_post_engagements',
      'page_daily_follows',
    ];

    const fetchInsights = async (metrics: string[]) => {
      const { data, error } = await (
        await fetch(
          `https://graph.facebook.com/v23.0/${id}/insights?metric=${metrics.join(
            ','
          )}&access_token=${accessToken}&period=day&since=${since}&until=${until}`
        )
      ).json();
      return error ? null : data ?? [];
    };

    // page_media_view returns paid/organic breakdowns as an object; sum them to
    // keep the single-total UI working.
    const sumValue = (value: any): number => {
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, number>).reduce(
          (sum: number, v: number) => sum + (Number(v) || 0),
          0
        );
      }
      return Number(value) || 0;
    };

    let data = await fetchInsights(allMetrics);
    if (data === null) {
      console.error(
        '[analytics:facebook] batch insights rejected for',
        id,
        '— a metric was likely deprecated by Meta; retrying each metric individually.'
      );
      const perMetric = await Promise.all(
        allMetrics.map((m) => fetchInsights([m]))
      );
      data = perMetric.filter((d) => Array.isArray(d)).flat();
    }
    if (!data?.length) {
      console.error(
        '[analytics:facebook] no insights for',
        id,
        '— token may lack read_insights/pages_read_engagement, or every metric is unavailable for this Page.'
      );
    }

    return (
      data?.map((d: any) => {
        const series =
          d?.values?.map((v: any) => ({
            total: sumValue(v.value),
            date: dayjs(v.end_time).format('YYYY-MM-DD'),
          })) || [];
        return {
          label:
            d.name === 'page_total_media_view_unique'
              ? 'Page Impressions'
              : d.name === 'page_post_engagements'
              ? 'Posts Engagement'
              : d.name === 'page_daily_follows'
              ? 'Page followers'
              : 'Media views',
          percentageChange: percentageChangeFromSeries(series),
          data: series,
        };
      }) || []
    );
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch post insights from Facebook Graph API.
      // post_impressions_unique was deprecated by Meta on 2026-06-15; it is replaced
      // by post_total_media_view_unique (unique media views = reach), available on
      // Graph API v23.0+. Engagement metrics below are unaffected.
      const { data } = await (
        await this.fetch(
          `https://graph.facebook.com/v23.0/${postId}/insights?metric=post_total_media_view_unique,post_reactions_by_type_total,post_clicks,post_clicks_by_type&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value;
        if (value === undefined) continue;

        let label = '';
        let total = '';

        switch (metric.name) {
          case 'post_total_media_view_unique':
            label = 'Impressions';
            total = String(value);
            break;
          case 'post_clicks':
            label = 'Clicks';
            total = String(value);
            break;
          case 'post_clicks_by_type':
            // This returns an object with click types
            if (typeof value === 'object') {
              const totalClicks = Object.values(
                value as Record<string, number>
              ).reduce((sum: number, v: number) => sum + v, 0);
              label = 'Clicks by Type';
              total = String(totalClicks);
            }
            break;
          case 'post_reactions_by_type_total':
            // This returns an object with reaction types
            if (typeof value === 'object') {
              const totalReactions = Object.values(
                value as Record<string, number>
              ).reduce((sum: number, v: number) => sum + v, 0);
              label = 'Reactions';
              total = String(totalReactions);
            }
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total, date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Facebook post analytics:', err);
      return [];
    }
  }
}
