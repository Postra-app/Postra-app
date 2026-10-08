import { Logger } from '@nestjs/common';
import { assertSafeInstanceUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import {
  AuthTokenDetails,
  PostDetails,
  AnalyticsData,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  BskyAgent,
  RichText,
  AppBskyEmbedVideo,
  AppBskyVideoDefs,
  AtpAgent,
  BlobRef,
} from '@atproto/api';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import sharp from 'sharp';
import { Plug } from '@gitroom/helpers/decorators/plug.decorator';
import { timer } from '@gitroom/helpers/utils/timer';
import { fetchMediaBuffer } from '@gitroom/nestjs-libraries/media/fetch.media.buffer';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

const logger = new Logger('BlueskyProvider');

async function reduceImageBySize(url: string, maxSizeKB = 976) {
  try {
    // Fetch the image from the URL (SSRF-guarded: path is client-controlled)
    let imageBuffer = await fetchMediaBuffer(url);

    // Use sharp to get the metadata of the image
    const metadata = await sharp(imageBuffer, {
      limitInputPixels: 100_000_000,
    }).metadata();
    let width = metadata.width!;
    let height = metadata.height!;

    // Resize iteratively until the size is below the threshold
    while (imageBuffer.length / 1024 > maxSizeKB) {
      width = Math.floor(width * 0.9); // Reduce dimensions by 10%
      height = Math.floor(height * 0.9);

      // Resize the image
      const resizedBuffer = await sharp(imageBuffer, {
        limitInputPixels: 100_000_000,
      })
        .resize({ width, height })
        .toBuffer();

      imageBuffer = resizedBuffer;

      if (width < 10 || height < 10) break; // Prevent overly small dimensions
    }

    return { width, height, buffer: imageBuffer };
  } catch (error) {
    logger.error(`Error processing image: ${(error as Error)?.message ?? error}`);
    throw error;
  }
}

// The video upload request. No Content-Length header: fetch derives it from
// the Buffer, and undici rejects one set by hand ("invalid content-length
// header", E2E-05-29: every Bluesky video failed with "fetch failed").
export const videoUploadRequest = (
  did: string,
  videoPath: string,
  token: string,
  body: Buffer
) => {
  const url = new URL('https://video.bsky.app/xrpc/app.bsky.video.uploadVideo');
  url.searchParams.append('did', did);
  url.searchParams.append('name', videoPath.split('/').pop()!.split('?')[0]);
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'video/mp4',
      },
      body,
    } as RequestInit,
  };
};

async function uploadVideo(
  agent: AtpAgent,
  videoPath: string
): Promise<AppBskyEmbedVideo.Main> {
  const { data: serviceAuth } = await agent.com.atproto.server.getServiceAuth({
    aud: `did:web:${agent.dispatchUrl.host}`,
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Date.now() / 1000 + 60 * 30, // 30 minutes
  });

  // The path is client-controlled: same SSRF-guarded download as images.
  const video = await fetchMediaBuffer(videoPath, 120_000);

  logger.debug(`Downloaded video ${videoPath} (${video.length} bytes)`);

  const request = videoUploadRequest(
    agent.session!.did,
    videoPath,
    serviceAuth.token,
    video
  );
  const uploadResponse = await fetch(request.url, request.init);
  if (!uploadResponse.ok) {
    throw new BadBody(
      'bluesky',
      JSON.stringify({ status: uploadResponse.status }),
      '',
      `Bluesky refused the video upload (${uploadResponse.status} ${uploadResponse.statusText})`
    );
  }

  const jobStatus = (await uploadResponse.json()) as AppBskyVideoDefs.JobStatus;
  logger.debug(`Video job ${jobStatus.jobId}`);
  let blob: BlobRef | undefined = jobStatus.blob;
  const videoAgent = new AtpAgent({ service: 'https://video.bsky.app' });

  while (!blob) {
    const { data: status } = await videoAgent.app.bsky.video.getJobStatus({
      jobId: jobStatus.jobId,
    });
    logger.debug(
      `Video job ${jobStatus.jobId}: ${status.jobStatus.state} ${
        status.jobStatus.progress || ''
      }`
    );
    if (status.jobStatus.blob) {
      blob = status.jobStatus.blob;
    }

    if (status.jobStatus.state === 'JOB_STATE_FAILED') {
      throw new BadBody(
        'bluesky',
        JSON.stringify({}),
        {} as any,
        'Could not upload video, job failed'
      );
    }

    await timer(30000);
  }

  logger.debug('Video processed, posting');

  return {
    $type: 'app.bsky.embed.video',
    video: blob,
  } satisfies AppBskyEmbedVideo.Main;
}

// A 4xx other than 429 from Bluesky's login: the credentials are refused.
export const loginRefusedCredentials = (err: unknown) => {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
};

@Rules(
  'Bluesky can have maximum 1 video or 4 pictures in one post, it can also be without attachments'
)
export class BlueskyProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2; // Bluesky has moderate rate limits
  identifier = 'bluesky';
  name = 'Bluesky';
  toolTip = "We don’t currently support two-factor authentication. If it’s enabled on Bluesky, you’ll need to disable it."
  isBetweenSteps = false;
  scopes = ['write:statuses', 'profile', 'write:media'];
  editor = 'normal' as const;
  maxLength() {
    return 300;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (
      posts?.some(
        (p) =>
          p?.some((a) => (a?.path?.indexOf?.('mp4') ?? -1) > -1) &&
          (p?.length ?? 0) > 1
      )
    ) {
      return 'You can only upload one video per post.';
    }

    if (posts?.some((p) => (p?.length ?? 0) > 4)) {
      return 'There can be maximum 4 pictures in a post.';
    }
    return true;
  }

  async customFields() {
    return [
      {
        key: 'service',
        label: 'Service',
        defaultValue: 'https://bsky.social',
        validation: `/^(https?:\\/\\/)?((([a-zA-Z0-9\\-_]{1,256}\\.[a-zA-Z]{2,6})|(([0-9]{1,3}\\.){3}[0-9]{1,3}))(:[0-9]{1,5})?)(\\/[^\\s]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'identifier',
        label: 'Identifier',
        validation: `/^.+$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
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
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());

    // The service URL comes from the client, and the server logs in there
    // with the user's credentials: any host, internal ones included
    // (E2E-04-24). Same rule as Lemmy's instance URL.
    let service: string;
    try {
      service = await assertSafeInstanceUrl(body.service, 'bluesky');
    } catch {
      return 'The Bluesky service must be a public HTTPS address';
    }

    try {
      const agent = new BskyAgent({
        service,
      });

      const {
        data: { accessJwt, refreshJwt, handle, did },
      } = await agent.login({
        identifier: body.identifier,
        password: body.password,
      });

      const profile = await agent.getProfile({
        actor: did,
      });

      return {
        refreshToken: refreshJwt,
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: accessJwt,
        id: did,
        name: profile.data.displayName!,
        picture: profile?.data?.avatar || '',
        username: profile.data.handle!,
      };
    } catch (e) {
      logger.warn(`Bluesky login failed: ${(e as Error)?.message ?? e}`);
      return 'Invalid credentials';
    }
  }

  private async getAgent(integration: Integration) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    const agent = new BskyAgent({
      service: body.service,
    });

    try {
      await agent.login({
        identifier: body.identifier,
        password: body.password,
      });
    } catch (err) {
      // Only a definite refusal means the app password is broken. A 5xx or
      // a network error is Bluesky being unavailable for a moment: marking
      // the channel "reconnect needed" for that failed every following post
      // with "Refresh channel needed" (upstream 0b26c98e).
      if (loginRefusedCredentials(err)) {
        throw new RefreshToken('bluesky', JSON.stringify(err), {} as BodyInit);
      }
      throw err;
    }

    return agent;
  }

  private async uploadMediaForPost(
    agent: BskyAgent,
    post: PostDetails
  ): Promise<{ embed: any; images: any[] }> {
    // Separate images and videos
    const imageMedia =
      post.media?.filter((p) => !hasExtension(p.path, 'mp4')) || [];
    const videoMedia =
      post.media?.filter((p) => hasExtension(p.path, 'mp4')) || [];

    // Upload images
    const images = await Promise.all(
      imageMedia.map(async (p) => {
        const { buffer, width, height } = await reduceImageBySize(p.path);
        return {
          width,
          height,
          buffer: await agent.uploadBlob(new Blob([buffer])),
        };
      })
    );

    // Upload videos (only one video per post is supported by Bluesky)
    let videoEmbed: AppBskyEmbedVideo.Main | null = null;
    if (videoMedia.length > 0) {
      videoEmbed = await uploadVideo(agent, videoMedia[0].path);
    }

    // Determine embed based on media types
    let embed: any = {};
    if (videoEmbed) {
      embed = videoEmbed;
    } else if (images.length > 0) {
      embed = {
        $type: 'app.bsky.embed.images',
        images: images.map((p, index) => ({
          alt: imageMedia?.[index]?.alt || '',
          image: p.buffer.data.blob,
          aspectRatio: {
            width: p.width,
            height: p.height,
          },
        })),
      };
    }

    return { embed, images };
  }

  // Statistics of one post from Bluesky's public AppView: likes, reposts,
  // replies and quotes. A public post needs no sign-in, and postAnalytics is
  // not given the account's app password anyway.
  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    try {
      const res = await fetch(
        `${
          process.env.BLUESKY_APPVIEW_URL || 'https://public.api.bsky.app'
        }/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(postId)}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) {
        return [];
      }
      const post = (await res.json())?.posts?.[0];
      if (!post) {
        return [];
      }
      return (
        [
          ['Likes', post.likeCount],
          ['Reposts', post.repostCount],
          ['Replies', post.replyCount],
          ['Quotes', post.quoteCount],
        ] as const
      )
        .filter(([, value]) => typeof value === 'number')
        .map(([label, value]) => ({
          label,
          percentageChange: 0,
          data: [{ total: String(value), date: today }],
        }));
    } catch {
      return [];
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const agent = await this.getAgent(integration);
    const [firstPost] = postDetails;

    const { embed } = await this.uploadMediaForPost(agent, firstPost);

    const rt = new RichText({
      text: firstPost.message,
    });

    await rt.detectFacets(agent);

    // @ts-ignore
    const { cid, uri, commit } = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      ...(Object.keys(embed).length > 0 ? { embed } : {}),
    });

    return [
      {
        id: firstPost.id,
        postId: uri,
        status: 'completed',
        releaseURL: `https://bsky.app/profile/${id}/post/${uri.split('/').pop()}`,
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const agent = await this.getAgent(integration);
    const [commentPost] = postDetails;

    const { embed } = await this.uploadMediaForPost(agent, commentPost);

    const rt = new RichText({
      text: commentPost.message,
    });

    await rt.detectFacets(agent);

    // Get the parent post info to get its CID
    const parentUri = lastCommentId || postId;

    // Fetch the parent post to get its CID
    const parentThread = await agent.getPostThread({
      uri: parentUri,
      depth: 0,
    });

    // @ts-ignore
    const parentCid = parentThread.data.thread.post?.cid;
    // @ts-ignore
    const rootUri = parentThread.data.thread.post?.record?.reply?.root?.uri || postId;
    // @ts-ignore
    const rootCid = parentThread.data.thread.post?.record?.reply?.root?.cid || parentCid;

    // @ts-ignore
    const { cid, uri, commit } = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      ...(Object.keys(embed).length > 0 ? { embed } : {}),
      reply: {
        root: {
          uri: rootUri,
          cid: rootCid,
        },
        parent: {
          uri: parentUri,
          cid: parentCid,
        },
      },
    });

    return [
      {
        id: commentPost.id,
        postId: uri,
        status: 'completed',
        releaseURL: `https://bsky.app/profile/${id}/post/${uri.split('/').pop()}`,
      },
    ];
  }

  @Plug({
    identifier: 'bluesky-autoRepostPost',
    title: 'Auto Repost Posts',
    description:
      'When a post reached a certain number of likes, repost it to increase engagement (1 week old posts)',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
    ],
  })
  async autoRepostPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string }
  ) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    const agent = new BskyAgent({
      service: body.service,
    });

    await agent.login({
      identifier: body.identifier,
      password: body.password,
    });

    const getThread = await agent.getPostThread({
      uri: id,
      depth: 0,
    });

    // @ts-ignore
    if (getThread.data.thread.post?.likeCount >= +fields.likesAmount) {
      await timer(2000);
      await agent.repost(
        // @ts-ignore
        getThread.data.thread.post?.uri,
        // @ts-ignore
        getThread.data.thread.post?.cid
      );
      return true;
    }

    return true;
  }

  @Plug({
    identifier: 'bluesky-autoPlugPost',
    title: 'Auto plug post',
    description:
      'When a post reached a certain number of likes, add another post to it so you followers get a notification about your promotion',
    runEveryMilliseconds: 21600000,
    totalRuns: 3,
    fields: [
      {
        name: 'likesAmount',
        type: 'number',
        placeholder: 'Amount of likes',
        description: 'The amount of likes to trigger the repost',
        validation: /^\d+$/,
      },
      {
        name: 'post',
        type: 'richtext',
        placeholder: 'Post to plug',
        description: 'Message content to plug',
        validation: /^[\s\S]{3,}$/g,
      },
    ],
  })
  async autoPlugPost(
    integration: Integration,
    id: string,
    fields: { likesAmount: string; post: string }
  ) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );
    const agent = new BskyAgent({
      service: body.service,
    });

    await agent.login({
      identifier: body.identifier,
      password: body.password,
    });

    const getThread = await agent.getPostThread({
      uri: id,
      depth: 0,
    });

    // @ts-ignore
    if (getThread.data.thread.post?.likeCount >= +fields.likesAmount) {
      await timer(2000);
      const rt = new RichText({
        text: stripHtmlValidation('normal', fields.post, true),
      });

      await agent.post({
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
        reply: {
          root: {
            // @ts-ignore
            uri: getThread.data.thread.post?.uri,
            // @ts-ignore
            cid: getThread.data.thread.post?.cid,
          },
          parent: {
            // @ts-ignore
            uri: getThread.data.thread.post?.uri,
            // @ts-ignore
            cid: getThread.data.thread.post?.cid,
          },
        },
      });
      return true;
    }

    return true;
  }

  override async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ) {
    const body = JSON.parse(
      AuthService.fixedDecryption(integration.customInstanceDetails!)
    );

    const agent = new BskyAgent({
      service: body.service,
    });

    await agent.login({
      identifier: body.identifier,
      password: body.password,
    });

    const list = await agent.searchActors({
      q: d.query,
    });

    return list.data.actors.map((p) => ({
      label: p.displayName,
      id: p.handle,
      image: p.avatar,
    }));
  }

  mentionFormat(idOrHandle: string, name: string) {
    return `@${idOrHandle}`;
  }
}
