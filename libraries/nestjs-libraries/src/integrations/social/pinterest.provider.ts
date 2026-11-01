import { fetchMediaStream } from '@gitroom/nestjs-libraries/media/fetch.media.buffer';
import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { PinterestSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import axios from 'axios';
import FormData from 'form-data';
import { timer } from '@gitroom/helpers/utils/timer';
import {
  BadBody,
  ProcessingTimeout,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

// PINTEREST_API_BASE points every API call (token exchange included) at
// another host: Trial apps may only create Pins on
// https://api-sandbox.pinterest.com, and a sandbox token comes only from the
// sandbox oauth/token. The consent screen stays on www.pinterest.com.
export const pinterestApi = (path: string) =>
  `${(process.env.PINTEREST_API_BASE || 'https://api.pinterest.com').replace(
    /\/+$/,
    ''
  )}/v5${path}`;

@Rules(
  'Pinterest requires at least one media, if posting a video, you must have two attachment, one for video, one for the cover picture, When posting a video, there can be only one, if posting images, there can be maximum 5'
)
export class PinterestProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'pinterest';
  name = 'Pinterest';
  isBetweenSteps = false;
  scopes = [
    'boards:read',
    'boards:write',
    'pins:read',
    'pins:write',
    'user_accounts:read',
  ];
  override maxConcurrentJob = 3; // Pinterest has more lenient rate limits
  maxLength() {
    return 500;
  }

  dto = PinterestSettingsDto;

  override async checkValidity(
    [firstItem]: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const isMp4 = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) > -1
    );
    const isPicture = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) === -1
    );
    if ((firstItem?.length ?? 0) === 0) {
      return 'Requires at least one media';
    }
    if ((firstItem?.length ?? 0) > 5) {
      return 'You can only have up to 5 media items';
    }
    if (isMp4 && firstItem?.length !== 2 && !isPicture) {
      return 'If posting a video you have to also include a cover image as second media';
    }
    if (isMp4 && (firstItem?.length ?? 0) > 2) {
      return 'If posting a video you can only have two media items';
    }

    if (
      (firstItem?.length ?? 0) > 1 &&
      firstItem?.every((p) => (p?.path?.indexOf?.('mp4') ?? -1) === -1)
    ) {
      const loadAll = await Promise.all(
        firstItem?.map((p) => this.getImageDimensions(p?.path)) ?? []
      );
      const checkAllTheSameWidthHeight = loadAll?.every((p, i, arr) => {
        return p?.width === arr?.[0]?.width && p?.height === arr?.[0]?.height;
      });
      if (!checkAllTheSameWidthHeight) {
        return 'Requires all images to have the same width and height';
      }
    }
    return true;
  }

  editor = 'normal' as const;

  public override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('constraint: maxItems=5') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You can upload a maximum of 5 images per post on Pinterest.',
      };
    }
    // Code 2787, transient on Pinterest's side (upstream 18a312b6b).
    if (body.indexOf('Something went wrong on our end') > -1) {
      return {
        type: 'retry' as const,
        value:
          'Pinterest reported a temporary error on their side. Please try posting again.',
      };
    }
    if (body.indexOf('Unable to reach the URL') > -1) {
      return {
        type: 'retry' as const,
        value: 'Pinterest was unable to reach the URL provided. Please check the link and try again.',
      }
    }
    // The board-id pattern arrives escaped a varying number of times; the
    // fixed string here matched none of them (upstream 002a341b).
    if (body.indexOf("does not match '^") > -1 && body.indexOf("d+$'") > -1) {
      return {
        type: 'bad-body' as const,
        value: 'The board ID must be a numeric string. Please check the board ID format.',
      }
    }
    if (body.indexOf('Board not found') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'The specified board was not found. Please check the board ID.',
      }
    }
    if (body.indexOf('You are not permitted to access that resource') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'The connected Pinterest account is not permitted to post to this board. Please check the board ID and that the account owns or can write to the board.',
      };
    }
    if (body.indexOf('cover_image_url or cover_image_content_type') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'When uploading a video, you must add also an image to be used as a cover image.',
      };
    }

    return undefined;
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, expires_in } = await (
      await fetch(pinterestApi('/oauth/token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: this.scopes.join(','),
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/pinterest`,
        }),
      })
    ).json();

    const { id, profile_image, username } = await (
      await fetch(pinterestApi('/user_account'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name: username,
      accessToken: access_token,
      refreshToken: refreshToken,
      expiresIn: expires_in,
      picture: profile_image || '',
      username,
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: `https://www.pinterest.com/oauth/?client_id=${
        process.env.PINTEREST_CLIENT_ID
      }&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/pinterest`
      )}&response_type=code&scope=${encodeURIComponent(
        'boards:read,boards:write,pins:read,pins:write,user_accounts:read'
      )}&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const { access_token, refresh_token, expires_in, scope } = await (
      await fetch(pinterestApi('/oauth/token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/pinterest`,
        }),
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const { id, profile_image, username } = await (
      await fetch(pinterestApi('/user_account'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name: username,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: profile_image,
      username,
    };
  }

  @Tool({ description: 'List of boards', dataSchema: [] })
  async boards(accessToken: string) {
    // Follow the bookmark: the sandbox can answer a page with no items and a
    // bookmark even when boards exist, and more than 250 boards spill over.
    const boards: { name: string; id: string }[] = [];
    let bookmark = '';
    for (let page = 0; page < 10; page++) {
      const { items, bookmark: next } = await (
        await fetch(
          pinterestApi(
            `/boards?page_size=250${
              bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''
            }`
          ),
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
      ).json();

      boards.push(
        ...(items || []).map((item: any) => ({
          name: item.name,
          id: item.id,
        }))
      );
      if (!next) {
        break;
      }
      bookmark = next;
    }

    return boards;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<PinterestSettingsDto>[]
  ): Promise<PostResponse[]> {
    let mediaId = '';
    const findMp4 = postDetails?.[0]?.media?.find((p) =>
      hasExtension(p.path, 'mp4')
    );
    const picture = postDetails?.[0]?.media?.find(
      (p) => !hasExtension(p.path, 'mp4')
    );

    if (findMp4) {
      const { upload_url, media_id, upload_parameters } = await (
        await this.fetch(pinterestApi('/media'), {
          method: 'POST',
          body: JSON.stringify({
            media_type: 'video',
          }),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        })
      ).json();

      // client-controlled path: SSRF guard (upstream 6c4a8ca4)
      // The video, not whatever came first — a cover image usually does
      // (upstream be413ec2).
      const data = await fetchMediaStream(findMp4.path);

      const formData = Object.keys(upload_parameters)
        .filter((f) => f)
        .reduce((acc, key) => {
          acc.append(key, upload_parameters[key]);
          return acc;
        }, new FormData());

      formData.append('file', data);
      await axios.post(upload_url, formData);

      let statusCode = '';
      // Capped under the 10-min activity budget (H1): an unbounded poll used
      // to blow the activity timeout and the retry re-published the pin.
      let mediaAttempts = 0;
      while (statusCode !== 'succeeded') {
        if (mediaAttempts++ >= 16) {
          throw new ProcessingTimeout('pinterest');
        }
        const mediafile = await (
          await this.fetch(
            pinterestApi('/media/' + media_id),
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
            '',
            0,
            true
          )
        ).json();

        if (mediafile.status === 'failed') {
          throw new BadBody(
            'pinterest',
            JSON.stringify({}),
            {} as any,
            'The file is corrupted and cannot be uploaded'
          );
        }

        await timer(30000);
        statusCode = mediafile.status;
      }

      mediaId = media_id;
    }

    const mapImages = postDetails?.[0]?.media?.map((m) => ({
      path: m.path,
    }));

    const { id: pId } = await (
      await this.fetch(pinterestApi('/pins'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(postDetails?.[0]?.settings.link
            ? { link: postDetails?.[0]?.settings.link }
            : {}),
          ...(postDetails?.[0]?.settings.title
            ? { title: postDetails?.[0]?.settings.title }
            : {}),
          description: postDetails?.[0]?.message,
          ...(postDetails?.[0]?.settings.dominant_color
            ? { dominant_color: postDetails?.[0]?.settings.dominant_color }
            : {}),
          board_id: postDetails?.[0]?.settings.board,
          media_source: mediaId
            ? {
                source_type: 'video_id',
                media_id: mediaId,
                cover_image_url: picture?.path,
              }
            : mapImages?.length === 1
            ? {
                source_type: 'image_url',
                url: mapImages?.[0]?.path,
              }
            : {
                source_type: 'multiple_image_urls',
                items: mapImages.map((m) => ({
                  url: m.path,
                })),
              },
        }),
      })
    ).json();

    return [
      {
        id: postDetails?.[0]?.id,
        postId: pId,
        releaseURL: `https://www.pinterest.com/pin/${pId}`,
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const until = dayjs().format('YYYY-MM-DD');
    // Pinterest analytics only cover the last 90 days, evaluated in UTC; 89
    // leaves a margin for the server's local date running ahead of UTC.
    const since = dayjs()
      .subtract(Math.min(date, 89), 'day')
      .format('YYYY-MM-DD');

    // An error body (expired token, or the sandbox, which has no account
    // analytics) has no `all`; it crashed the destructuring and the page.
    const body = await (
      await fetch(
        pinterestApi(
          `/user_account/analytics?start_date=${since}&end_date=${until}`
        ),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )
    ).json();
    const daily_metrics: any[] = body?.all?.daily_metrics || [];

    const result = daily_metrics.reduce(
      (acc: any, item: any) => {
        if (typeof item.metrics.PIN_CLICK_RATE !== 'undefined') {
          // A fraction (0.25 = 25 %); the card shows percent.
          acc[0].data.push({
            date: item.date,
            total:
              Math.round((Number(item.metrics.PIN_CLICK_RATE) || 0) * 10000) /
              100,
          });

          acc[1].data.push({
            date: item.date,
            total: item.metrics.IMPRESSION,
          });

          acc[2].data.push({
            date: item.date,
            total: item.metrics.PIN_CLICK,
          });

          acc[3].data.push({
            date: item.date,
            total: item.metrics.ENGAGEMENT,
          });

          acc[4].data.push({
            date: item.date,
            total: item.metrics.SAVE,
          });
        }

        return acc;
      },
      [
        { label: 'Pin click rate', data: [] as any[] },
        { label: 'Impressions', data: [] as any[] },
        { label: 'Pin Clicks', data: [] as any[] },
        { label: 'Engagement', data: [] as any[] },
        { label: 'Saves', data: [] as any[] },
      ]
    );

    // The period's click rate is its clicks over its impressions: the sum of
    // the daily rates read "1" for 1 click on 4 impressions.
    const impressions = result[1].data.reduce(
      (sum: number, d: any) => sum + (Number(d.total) || 0),
      0
    );
    const clicks = result[2].data.reduce(
      (sum: number, d: any) => sum + (Number(d.total) || 0),
      0
    );
    result[0] = {
      ...result[0],
      average: true,
      unit: 'percent',
      summary: impressions
        ? Math.round((clicks / impressions) * 10000) / 100
        : 0,
    };
    return result;
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    // Pinterest only serves pin analytics for the last 90 days (89 for the same
    // UTC margin as above). The old 2-year range was rejected on every call, so
    // pin analytics came back empty every time.
    const since = dayjs().subtract(89, 'day').format('YYYY-MM-DD');

    try {
      // Fetch pin analytics from Pinterest API
      const response = await fetch(
        pinterestApi(
          `/pins/${postId}/analytics?start_date=${since}&end_date=${today}&metric_types=IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE`
        ),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!data || !data.all) {
        return [];
      }

      const result: AnalyticsData[] = [];
      const metrics = data.all;

      // These are period metrics: Pinterest returns them in summary_metrics;
      // lifetime_metrics only ever carries comments and reactions, so every
      // pin showed no analytics (upstream 8f92a37e).
      if (metrics.summary_metrics) {
        const lifetimeMetrics = metrics.summary_metrics;

        if (lifetimeMetrics.IMPRESSION !== undefined) {
          result.push({
            label: 'Impressions',
            percentageChange: 0,
            data: [{ total: String(lifetimeMetrics.IMPRESSION), date: today }],
          });
        }

        if (lifetimeMetrics.PIN_CLICK !== undefined) {
          result.push({
            label: 'Pin Clicks',
            percentageChange: 0,
            data: [{ total: String(lifetimeMetrics.PIN_CLICK), date: today }],
          });
        }

        if (lifetimeMetrics.OUTBOUND_CLICK !== undefined) {
          result.push({
            label: 'Outbound Clicks',
            percentageChange: 0,
            data: [
              { total: String(lifetimeMetrics.OUTBOUND_CLICK), date: today },
            ],
          });
        }

        if (lifetimeMetrics.SAVE !== undefined) {
          result.push({
            label: 'Saves',
            percentageChange: 0,
            data: [{ total: String(lifetimeMetrics.SAVE), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Pinterest post analytics:', err);
      return [];
    }
  }
}
