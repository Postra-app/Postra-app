import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/meta.graph.version';
import { Logger } from '@nestjs/common';
import { numericId } from '@gitroom/nestjs-libraries/integrations/social/numeric.id';
import {
  AnalyticsData,
  AuthTokenDetails,
  MediaContent,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';
import {
  BadBody,
  ProcessingTimeout,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { percentageChangeFromSeries } from '@gitroom/nestjs-libraries/integrations/social/analytics.utils';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { toInstagramSafeAspect } from '@gitroom/nestjs-libraries/integrations/social/instagram.aspect';

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramProvider
  extends SocialAbstract
  implements SocialProvider
{
  private readonly _logger = new Logger(InstagramProvider.name);
  identifier = 'instagram';
  name = 'Instagram\n(Facebook Business)';
  isBetweenSteps = true;
  toolTip = 'Instagram must be business and connected to a Facebook page';
  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_insights',
    'instagram_manage_comments',
  ];
  // instagram_manage_comments holds Advanced Access on this app, so Meta grants
  // it to every user and first comment works for everyone — but it is asked for,
  // not required. Requiring a scope is exactly what broke connect for every
  // external user in #188: the moment Meta moves one back to Standard, or it
  // stops appearing (which is what we mistakenly believed had happened to this
  // one), checkScopes rejects the entire connect. Asked-not-required degrades to
  // "the feature hides itself on that channel", and the publish workflow reports
  // it instead of dropping the comment in silence.
  optionalScopes = ['instagram_manage_comments'];
  commentScope = 'instagram_manage_comments';
  override maxConcurrentJob = 400;
  editor = 'normal' as const;
  dto = InstagramDto;
  private storage = UploadFactory.createStorage();
  maxLength() {
    return 2200;
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    if (firstPost.length > 10) {
      return 'Instagram carousel only supports up to 10 media attachments';
    }
    if (settings?.is_trial_reel) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    return true;
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

  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('An unknown error occurred') > -1) {
      return {
        type: 'retry' as const,
        value: 'An unknown error occurred, please try again later',
      };
    }
    // Instagram caps how many Trial Reels an account may publish (upstream
    // 66d21018).
    if (body.indexOf('2207078') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram Trial Reel publish limit reached for this account, please try again later or publish the post as a regular Reel',
      };
    }
    if (body.indexOf('2207081') > -1) {
      return {
        type: 'bad-body' as const,
        value: "This account doesn't support Trial Reels",
      };
    }

    if (
      body.indexOf('REVOKED_ACCESS_TOKEN') > -1 ||
      body.indexOf('"error_subcode":33') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Something is wrong with your connected user, please re-authenticate',
      };
    }

    if (
      body.toLowerCase().indexOf('the user is not an instagram business') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Your Instagram account is not a business account, please convert it to a business account',
      };
    }

    if (body.toLowerCase().indexOf('session has been invalidated') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again',
      };
    }

    if (body.indexOf('2207050') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram user is restricted',
      };
    }

    // Media download/upload errors
    if (body.indexOf('2207003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Timeout downloading media, please try again',
      };
    }

    if (body.indexOf('2207020') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media expired, please upload again',
      };
    }

    if (body.indexOf('2207032') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to create media, please try again',
      };
    }

    if (body.indexOf('2207053') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown upload error, please try again',
      };
    }

    if (body.indexOf('2207052') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media fetch failed, please try again',
      };
    }

    if (body.indexOf('2207057') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid thumbnail offset for video',
      };
    }

    if (body.indexOf('2207026') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported video format',
      };
    }

    if (body.indexOf('2207023') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown media type',
      };
    }

    if (body.indexOf('2207006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media not found, please upload again',
      };
    }

    if (body.indexOf('2207008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media builder expired, please try again',
      };
    }

    // Content validation errors
    if (body.indexOf('2207028') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Carousel validation failed',
      };
    }

    if (body.indexOf('2207010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Caption is too long',
      };
    }

    // Product tagging errors
    if (body.indexOf('2207035') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions not supported for videos',
      };
    }

    if (body.indexOf('2207036') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions required for photos',
      };
    }

    if (body.indexOf('2207037') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag validation failed',
      };
    }

    if (body.indexOf('2207040') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Too many product tags',
      };
    }

    // Image format/size errors
    if (body.indexOf('2207004') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Image is too large',
      };
    }

    if (body.indexOf('2207005') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported image format',
      };
    }

    if (body.indexOf('2207009') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('Page request limit reached') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Page posting for today is limited, please try again tomorrow',
      };
    }

    if (body.indexOf('2207042') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have reached the maximum of 25 posts per day, allowed for your account',
      };
    }

    if (body.indexOf('(#200)') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Facebook rejected the post due to missing permissions. Make sure your Facebook account has full content access to the Page linked to this Instagram account, then reconnect the channel.',
      };
    }

    if (body.indexOf('Not enough permissions to post') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Not enough permissions to post',
      };
    }

    if (body.indexOf('36003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    // Meta put the account behind a checkpoint: every post fails until the
    // user logs in on Instagram. Our "refresh-token" marks the channel for
    // reconnecting (Instagram has no token refresh), so later posts stop
    // failing one by one and the user is told what to do (upstream 28730a0c).
    if (
      body.indexOf('You cannot access the app till you log in to') > -1 ||
      body.indexOf('Session key is malformed') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Instagram requires you to log in at instagram.com and follow its instructions before posting can resume. After that, please reconnect this channel.',
      };
    }

    if (body.indexOf('190,') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'The account is missing some permissions to perform this action, please re-add the account and allow all permissions',
      };
    }

    if (body.indexOf('36001') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid Instagram image resolution max: 1920x1080px',
      };
    }

    if (body.indexOf('2207051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram blocked your request',
      };
    }

    if (body.indexOf('2207001') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram detected that your post is spam, please try again with different content',
      };
    }

    if (body.indexOf('2207082') > -1) {
      return {
        type: 'retry' as const,
        value:
          'Instagram could not process this video. If you attached audio to a video that has no sound track, set the original video volume to 0 and try again',
      };
    }

    if (body.indexOf('2207085') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram could not process the video, please check the video format, duration and resolution and try again',
      };
    }

    if (body.indexOf('2207077') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram Video download failed',
      };
    }

    if (body.indexOf('too little or too many attachments') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram carousel should have between 2 and 10 media attachments',
      }
    }

    if (body.indexOf('2207027') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown error, please try again later or contact support',
      };
    }

    if (body.indexOf('param collaborators is not allowed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Collaborators are not allowed for carousel',
      };
    }

    return undefined;
  }

  // A container Instagram could not process (ERROR) or that ran out of time
  // (EXPIRED) used to fall through to media_publish, which failed with an
  // unrelated message. Fail with the reason Instagram gave, curated where we
  // know it (upstream f4bd43f2, c693a97e).
  failedContainer(statusCode: string, reason?: string) {
    if (statusCode !== 'ERROR' && statusCode !== 'EXPIRED') {
      return;
    }
    const json = JSON.stringify({ status_code: statusCode, status: reason });
    const handled = this.handleErrors(reason || '', 200);
    if (handled?.type === 'refresh-token') {
      throw new RefreshToken(this.identifier, json, '{}', handled.value);
    }
    throw new BadBody(
      this.identifier,
      json,
      '{}',
      handled?.value || reason || 'Instagram could not process the media'
    );
  }

  async reConnect(
    id: string,
    requiredId: string,
    token: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const [accessToken, userToken] = token.split('___');
    const findPage = (await this.pages(accessToken)).find(
      (p) => p.id === requiredId
    );

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      pageId: findPage?.pageId!,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/instagram`
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const getAccessToken = await (
      await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token` +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/instagram${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token, expires_in, ...all } = await (
      await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token` +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/permissions?access_token=${access_token}`
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
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me?fields=id,name,picture&access_token=${access_token}`
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
      grantedScopes: permissions,
    };
  }

  async pages(token: string) {
    const [accessToken, userToken] = token.split('___');
    const seenPageIds = new Set<string>();
    const allFacebookPages: any[] = [];

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const response = await (await fetch(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenPageIds.has(page.id)) {
              seenPageIds.add(page.id);
              allFacebookPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    await fetchPaginated(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/accounts?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
    );

    // Also fetch pages via Business Manager API to discover pages
    // not selected during the OAuth page selection step
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              await fetchPaginated(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${business.id}/owned_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }

            try {
              await fetchPaginated(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${business.id}/client_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
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

    const onlyConnectedAccounts = await Promise.all(
      allFacebookPages
        .filter((f: any) => f.instagram_business_account)
        .map(async (p: any) => {
          return {
            pageId: p.id,
            ...(await (
              await fetch(
                `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${p.instagram_business_account.id}?fields=name,username,profile_picture_url&access_token=${accessToken}`
              )
            ).json()),
            id: p.instagram_business_account.id,
          };
        })
    );

    // `name` is the profile's optional display name and came back empty on
    // production, leaving the account picker with bare pictures. The handle is
    // always there; send both.
    return onlyConnectedAccounts.map((p: any) => ({
      pageId: p.pageId,
      id: p.id,
      name: p.name || p.username || '',
      username: p.username || '',
      picture: { data: { url: p.profile_picture_url } },
    }));
  }

  async fetchPageInformation(
    token: string,
    data: { pageId: string; id: string }
  ) {
    const [accessToken, userToken] = token.split('___');
    const pageId = numericId(data?.pageId);
    const accountId = numericId(data?.id);
    const { access_token, ...all } = await (
      await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${pageId}?fields=access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    const { id, name, profile_picture_url, username } = await (
      await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${accountId}?fields=username,name,profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      id,
      name,
      picture: profile_picture_url,
      access_token: access_token + '___' + accessToken,
      username,
    };
  }

  // Instagram feed photos must sit within 4:5 (0.8) .. 1.91:1 or Meta rejects the
  // whole post with "Aspect ratio not supported" (2207009) — historically our
  // single biggest source of failed IG publishes. Center-crop any out-of-band feed
  // image just enough to clear validation and re-host it so Meta can fetch the URL.
  // Stories are full-screen (any ratio) and videos/Reels have their own bounds, so
  // both pass through untouched. Never blocks a post: on any failure the original
  // media is used and Meta's own error handling still applies.
  private async toInstagramSafeMedia(
    media: MediaContent[] | undefined,
    isStory: boolean
  ): Promise<MediaContent[]> {
    if (isStory || !media?.length) {
      return media || [];
    }
    return Promise.all(
      media.map(async (m) => {
        if (hasExtension(m.path, 'mp4')) {
          return m;
        }
        try {
          const normalized = await toInstagramSafeAspect(m.path);
          if (!normalized.startsWith('data:')) {
            return m; // already in-band, or could not be processed
          }
          return { ...m, path: await this.storage.uploadSimple(normalized) };
        } catch {
          // A re-host hiccup must never block a post — fall back to the original
          // media and let Meta's own validation/error handling take over.
          return m;
        }
      })
    );
  }

  async post(
    id: string,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken, userToken] = token.split('___');
    const [firstPost] = postDetails;
    this._logger.debug(`Publishing to ${id}`);
    const isStory = firstPost.settings.post_type === 'story';
    const isTrialReel = !!firstPost.settings.is_trial_reel;
    const safeMedia = await this.toInstagramSafeMedia(
      firstPost?.media,
      isStory
    );
    // Collaborators go on the post itself: a single item, or the carousel
    // container — Meta refuses them on carousel children. Sent URL-encoded
    // and without a leading @, which Instagram rejects (2207018) and the tag
    // input keeps as typed (upstream a9aced7d, 0a8c28fb, 1de15370).
    const collaborators =
      firstPost?.settings?.collaborators?.length && !isStory
        ? `&collaborators=${encodeURIComponent(
            JSON.stringify(
              firstPost.settings.collaborators.map((p) =>
                p.label.replace(/^@+/, '')
              )
            )
          )}`
        : ``;
    const medias = await Promise.all(
      safeMedia.map(async (m) => {
        const caption =
          firstPost.media?.length === 1
            ? `&caption=${encodeURIComponent(firstPost.message)}`
            : ``;
        const isCarousel =
          (firstPost?.media?.length || 0) > 1 && !isStory
            ? `&is_carousel_item=true`
            : ``;
        const mediaType = hasExtension(m.path, 'mp4')
          ? firstPost?.media?.length === 1
            ? isStory
              ? `video_url=${m.path}&media_type=STORIES`
              : `video_url=${m.path}&media_type=REELS&thumb_offset=${
                  m?.thumbnailTimestamp || 0
                }`
            : isStory
            ? `video_url=${m.path}&media_type=STORIES`
            : `video_url=${m.path}&media_type=VIDEO&thumb_offset=${
                m?.thumbnailTimestamp || 0
              }`
          : isStory
          ? `image_url=${m.path}&media_type=STORIES`
          : `image_url=${m.path}`;

        const trialParams = isTrialReel
          ? `&trial_params=${encodeURIComponent(
              JSON.stringify({
                graduation_strategy:
                  firstPost.settings.graduation_strategy || 'MANUAL',
              })
            )}`
          : ``;

        const itemCollaborators =
          firstPost?.media?.length === 1 ? collaborators : ``;

        const { id: photoId } = await (
          await this.fetch(
            `https://${type}/v20.0/${id}/media?${mediaType}${isCarousel}${itemCollaborators}${trialParams}&access_token=${accessToken}${caption}`,
            {
              method: 'POST',
            }
          )
        ).json();
        this._logger.debug(`Media container created for ${id}, waiting for processing`);

        let status = 'IN_PROGRESS';
        // Capped under the 10-min activity budget (H1): an unbounded poll
        // used to blow the activity timeout and the retry re-published.
        let processingAttempts = 0;
        while (status === 'IN_PROGRESS') {
          if (processingAttempts++ >= 14) {
            throw new ProcessingTimeout('instagram');
          }
          const { status_code, status: reason } = await (
            await this.fetch(
              `https://${type}/v20.0/${photoId}?access_token=${
                userToken || accessToken
              }&fields=status_code,status`,
              undefined,
              '',
              0,
              true
            )
          ).json();
          this.failedContainer(status_code, reason);
          await timer(30000);
          status = status_code;
        }
        this._logger.debug(`Media processed for ${id}`);

        return photoId;
      }) || []
    );

    if (isStory && medias.length > 1) {
      // Stories don't support carousels - publish each media as a separate story
      let lastMediaId = '';
      let lastPermalink = '';
      for (const mediaCreationId of medias) {
        const { id: mediaId } = await (
          await this.fetch(
            `https://${type}/v20.0/${id}/media_publish?creation_id=${mediaCreationId}&access_token=${accessToken}&field=id`,
            {
              method: 'POST',
            }
          )
        ).json();
        lastMediaId = mediaId;

        const { permalink } = await (
          await this.fetch(
            `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${
              userToken || accessToken
            }`
          )
        ).json();
        lastPermalink = permalink;
      }

      return [
        {
          id: firstPost.id,
          postId: lastMediaId,
          releaseURL: lastPermalink,
          status: 'success',
        },
      ];
    } else if (medias.length === 1) {
      const { id: mediaId } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media_publish?creation_id=${medias[0]}&access_token=${accessToken}&field=id`,
          {
            method: 'POST',
          }
        )
      ).json();

      const { permalink } = await (
        await this.fetch(
          `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${
            userToken || accessToken
          }`
        )
      ).json();

      return [
        {
          id: firstPost.id,
          postId: mediaId,
          releaseURL: permalink,
          status: 'success',
        },
      ];
    } else {
      const { id: containerId, ...all3 } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media?caption=${encodeURIComponent(
            firstPost?.message
          )}&media_type=CAROUSEL&children=${encodeURIComponent(
            medias.join(',')
          )}${collaborators}&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();

      let status = 'IN_PROGRESS';
      // Same cap as the per-media poll above: the carousel container poll was
      // still unbounded, so a container stuck on IN_PROGRESS ran until Temporal
      // killed the activity and the retry re-published the carousel.
      let carouselAttempts = 0;
      while (status === 'IN_PROGRESS') {
        if (carouselAttempts++ >= 14) {
          throw new ProcessingTimeout('instagram');
        }
        const { status_code, status: reason } = await (
          await this.fetch(
            `https://${type}/v20.0/${containerId}?fields=status_code,status&access_token=${
              userToken || accessToken
            }`,
            undefined,
            '',
            0,
            true
          )
        ).json();
        this.failedContainer(status_code, reason);
        await timer(30000);
        status = status_code;
      }

      const { id: mediaId, ...all4 } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media_publish?creation_id=${containerId}&access_token=${accessToken}&field=id`,
          {
            method: 'POST',
          }
        )
      ).json();

      const { permalink } = await (
        await this.fetch(
          `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${
            userToken || accessToken
          }`
        )
      ).json();

      return [
        {
          id: firstPost.id,
          postId: mediaId,
          releaseURL: permalink,
          status: 'success',
        },
      ];
    }
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken, userToken] = token.split('___');
    const [commentPost] = postDetails;

    const { id: commentId } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}/comments?message=${encodeURIComponent(
          commentPost.message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    // Get the permalink from the parent post
    const { permalink } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}?fields=permalink&access_token=${
          userToken || accessToken
        }`
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: commentId,
        releaseURL: permalink,
        status: 'success',
      },
    ];
  }

  private setTitle(name: string) {
    switch (name) {
      case 'likes': {
        return 'Likes';
      }

      case 'followers': {
        return 'Followers';
      }

      case 'reach': {
        return 'Reach';
      }

      case 'follower_count': {
        return 'Follower Count';
      }

      case 'views': {
        return 'Views';
      }

      case 'comments': {
        return 'Comments';
      }

      case 'shares': {
        return 'Shares';
      }

      case 'saves': {
        return 'Saves';
      }

      case 'replies': {
        return 'Replies';
      }
    }

    return '';
  }

  async checkToken(token: string, internalId: string): Promise<boolean> {
    try {
      const [accessToken] = token.split('___');
      const { error } = await (
        await fetch(
          `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${internalId}?fields=id&access_token=${accessToken}`
        )
      ).json();
      // 190 = token revoked/expired; transient errors keep the channel alive.
      return error?.code !== 190;
    } catch {
      return true;
    }
  }

  async analytics(
    id: string,
    token: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');
    const until = dayjs().startOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    // If either insights call errored, log it (and don't let an undefined
    // payload throw on .map below — a single failed call should degrade to a
    // partial panel, not wipe the whole channel's analytics).
    if (!data || !data2) {
      this._logger.warn(
        `[analytics:instagram] partial/empty for ${id} - reach/follower error: ${
          (all as any)?.error?.message
        } | engagement error: ${(all2 as any)?.error?.message}`
      );
    }

    const analytics = [];

    analytics.push(
      ...(data?.map((d: any) => {
        const series = d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        }));
        return {
          label: this.setTitle(d.name),
          percentageChange: percentageChangeFromSeries(series),
          data: series,
        };
      }) || [])
    );

    analytics.push(
      ...((data2 || []).map((d: any) => ({
        label: this.setTitle(d.name),
        // Single lifetime total — no prior period to compare against, so no
        // trend (the UI hides the badge at 0).
        percentageChange: 0,
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
        ],
      })))
    );

    return analytics;
  }

  music(accessToken: string, data: { q: string }) {
    return this.fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/music/search?q=${encodeURIComponent(
        data.q
      )}&access_token=${accessToken}`
    );
  }

  async postAnalytics(
    integrationId: string,
    token: string,
    postId: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch media insights from Instagram Graph API
      const { data } = await (
        await this.fetch(
          `https://${type}/v21.0/${postId}/insights?metric=views,reach,saved,likes,comments,shares&access_token=${accessToken}`
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

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'reach':
            label = 'Reach';
            break;
          case 'engagement':
            label = 'Engagement';
            break;
          case 'saved':
            label = 'Saves';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'comments':
            label = 'Comments';
            break;
          case 'shares':
            label = 'Shares';
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      this._logger.warn(`Error fetching Instagram post analytics: ${(err as Error)?.message ?? err}`);
      return [];
    }
  }
}
