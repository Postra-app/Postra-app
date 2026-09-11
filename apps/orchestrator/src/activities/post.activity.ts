import { Injectable } from '@nestjs/common';
import {
  Activity,
  ActivityMethod,
  TemporalService,
} from 'nestjs-temporal-core';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AuthTokenDetails,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { canPostComments } from '@gitroom/nestjs-libraries/integrations/social/comment.capability';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
    return (
      v6 === '::1' ||
      v6 === '::' ||
      /^f[cd]/.test(v6) ||
      v6.startsWith('fe80')
    );
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

// Webhook URLs are user-supplied — without this check a webhook pointed at the
// VPC (Temporal UI, Redis, IMDS) turns every published post into an internal
// request proxy.
async function assertPublicWebhookUrl(raw: string) {
  const url = new URL(raw);
  // https only: an http webhook can be MITM'd and the DTO validator
  // (IsSafeWebhookUrl) never allowed it in the first place.
  if (url.protocol !== 'https:') {
    throw new Error(`webhook protocol not allowed: ${url.protocol}`);
  }
  const address = isIP(url.hostname)
    ? url.hostname
    : (await lookup(url.hostname)).address;
  if (isPrivateIp(address)) {
    throw new Error(`webhook resolves to a private address: ${url.hostname}`);
  }
}

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

@Injectable()
@Activity()
export class PostActivity {
  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _temporalService: TemporalService,
    private _subscriptionService: SubscriptionService
  ) {}

  @ActivityMethod()
  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPosts() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      await this._temporalService.client
        .getRawClient()
        .workflow.signalWithStart('postWorkflowV107', {
          workflowId: `post_${post.id}`,
          taskQueue: 'main',
          signal: 'poke',
          workflowIdConflictPolicy: 'USE_EXISTING',
          signalArgs: [],
          args: [
            {
              taskQueue: post.integration.providerIdentifier
                .split('-')[0]
                .toLowerCase(),
              postId: post.id,
              organizationId: post.organizationId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: post.id,
            },
            {
              key: organizationId,
              value: post.organizationId,
            },
          ]),
        });
    }
  }

  @ActivityMethod()
  async updatePost(
    id: string,
    postId: string,
    releaseURL: string,
    orgId?: string
  ) {
    await this._postService.updatePost(id, postId, releaseURL, orgId);
  }

  @ActivityMethod()
  async clearReleases(orgId: string, ids: string[]) {
    await this._postService.clearReleases(orgId, ids);
  }

  @ActivityMethod()
  async getPost(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    const post = await this._postService.getPostById(postId, orgId);
    // `!post`, not `post.deletedAt`. getPostById is a findUnique whose where
    // clause already carries `deletedAt: null` and the organization id, so it
    // answers null for a post that was deleted, or that belongs to somebody
    // else — and `post.deletedAt` on null threw an unhandled TypeError inside
    // the activity. The workflow right above this already has the correct
    // guard (`if (!firstPost) changeState('ERROR', 'No Post')`), and it could
    // never be reached: Temporal retried a throwing activity instead of taking
    // the path written for exactly this case. The old condition was also dead
    // by construction — a non-null row here always has deletedAt null
    // (E2E-05-03).
    if (!post) {
      return false;
    }

    return post;
  }

  @ActivityMethod()
  async getPostsList(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    return getPosts.map(slimPost);
  }

  @ActivityMethod()
  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return canPostComments(getIntegration, integration);
  }

  @ActivityMethod()
  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    integration.token = AuthService.decryptIntegrationToken(integration.token);
    if (integration.refreshToken) {
      integration.refreshToken = AuthService.decryptIntegrationToken(
        integration.refreshToken
      );
    }

    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    // Same idempotency guard as postSocial: comments are their own Post rows,
    // and a retry after the platform accepted one must not post it again.
    const fresh = await Promise.all(
      (posts || []).map((p) =>
        this._postService.getPostById(p.id, integration.organizationId)
      )
    );
    if (fresh.length && fresh.every((p) => p?.releaseId)) {
      console.log(
        `[postComment] already published, skipping republish provider=${
          integration.providerIdentifier
        } posts=${fresh.map((p) => `${p!.id}:${p!.releaseId}`).join(',')}`
      );
      return fresh.map((p) => ({
        id: p!.id,
        postId: p!.releaseId!,
        releaseURL: p!.releaseURL || '',
        status: 'posted',
      }));
    }

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    const comments = await getIntegration.comment(
      integration.internalId,
      postId,
      lastPostId,
      integration.token,
      await Promise.all(
        (newPosts || []).map(async (p) => ({
          id: p.id,
          message: stripHtmlValidation(
            getIntegration.editor,
            p.content,
            true,
            false,
            !/<\/?[a-z][\s\S]*>/i.test(p.content),
            getIntegration.mentionFormat
          ),
          settings: JSON.parse(p.settings || '{}'),
          media: await this._postService.updateMedia(
            integration.organizationId,
            p.id,
            JSON.parse(p.image || '[]'),
            getIntegration?.convertToJPEG || false
          ),
        }))
      ),
      integration
    );

    // Persist immediately for the same reason as postSocial above.
    for (const response of comments || []) {
      if (response?.id && response?.postId) {
        try {
          await this._postService.updatePost(
            response.id,
            response.postId,
            response.releaseURL || '',
            integration.organizationId
          );
        } catch (err) {
          console.error(
            `[postComment] failed to persist release for post=${response.id}`,
            err
          );
        }
      }
    }

    return comments;
  }

  @ActivityMethod()
  async postSocial(integration: Integration, posts: Post[]) {
    integration.token = AuthService.decryptIntegrationToken(integration.token);
    if (integration.refreshToken) {
      integration.refreshToken = AuthService.decryptIntegrationToken(
        integration.refreshToken
      );
    }

    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        integration.organizationId
      );

      if (!subscription) {
        throw new Error('No active subscription found for this organization.');
      }
    }

    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    // Idempotency guard (H1, duplicate posts): a retry — a Temporal
    // re-attempt or the workflow's repeat loop — re-runs this activity with
    // posts snapshotted at workflow start. If a previous attempt already got
    // the post accepted by the platform, publishing again creates a public
    // duplicate, so re-read the posts and short-circuit with the saved result.
    const fresh = await Promise.all(
      (posts || []).map((p) =>
        this._postService.getPostById(p.id, integration.organizationId)
      )
    );
    if (fresh.length && fresh.every((p) => p?.releaseId)) {
      console.log(
        `[postSocial] already published, skipping republish provider=${
          integration.providerIdentifier
        } posts=${fresh.map((p) => `${p!.id}:${p!.releaseId}`).join(',')}`
      );
      return fresh.map((p) => ({
        id: p!.id,
        postId: p!.releaseId!,
        releaseURL: p!.releaseURL || '',
        status: 'posted',
      }));
    }

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      posts
    );

    let postNow: PostResponse[];
    try {
      postNow = await getIntegration.post(
        integration.internalId,
        integration.token,
        await Promise.all(
          (newPosts || []).map(async (p) => ({
            id: p.id,
            message: stripHtmlValidation(
              getIntegration.editor,
              p.content,
              true,
              false,
              !/<\/?[a-z][\s\S]*>/i.test(p.content),
              getIntegration.mentionFormat
            ),
            settings: JSON.parse(p.settings || '{}'),
            media: await this._postService.updateMedia(
              integration.organizationId,
              p.id,
              JSON.parse(p.image || '[]'),
              getIntegration?.convertToJPEG || false
            ),
          }))
        ),
        integration
      );
    } catch (err: any) {
      // Ties the raw API-response log (SocialAbstract.fetch) to a concrete
      // channel and post — Temporal's own failure line only carries workflowId.
      console.error(
        `[postSocial] failed provider=${integration.providerIdentifier} integrationId=${
          integration.id
        } channel=${integration.name} posts=${(newPosts || [])
          .map((p) => p.id)
          .join(',')} error=${err?.message || err}`
      );
      throw err;
    }

    // Persist the platform's acknowledgement immediately. The workflow's own
    // updatePost is a separate activity that runs later — any failure in
    // between used to land back here on retry and publish a duplicate.
    // A persist failure is swallowed: the publish DID happen, and the
    // workflow's updatePost is the second chance to record it.
    for (const response of postNow || []) {
      if (response?.id && response?.postId) {
        try {
          await this._postService.updatePost(
            response.id,
            response.postId,
            response.releaseURL || '',
            integration.organizationId
          );
        } catch (err) {
          console.error(
            `[postSocial] failed to persist release for post=${response.id}`,
            err
          );
        }
      }
    }

    await this._temporalService.client
      .getRawClient()
      .workflow.start('streakWorkflow', {
        args: [{ organizationId: integration.organizationId }],
        workflowId: `streak_${integration.organizationId}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: organizationId,
            value: integration.organizationId,
          },
        ]),
      });

    return postNow;
  }

  @ActivityMethod()
  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type
    );
  }

  @ActivityMethod()
  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async changeState(id: string, state: State, err?: any, body?: any) {
    await this._postService.changeState(id, state, err, body);
  }

  @ActivityMethod()
  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
      (f) => {
        return (
          f.integrations.length === 0 ||
          f.integrations.some((i) => i.integration.id === integrationId)
        );
      }
    );

    const post = await this._postService.getPostByForWebhookId(postId);
    await Promise.all(
      webhooks.map(async (webhook) => {
        try {
          await assertPublicWebhookUrl(webhook.url);
          // ssrfSafeDispatcher pins DNS (TOCTOU/rebinding) and redirect:
          // 'error' stops a 302 from bouncing the request into the VPC/IMDS.
          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(post),
            dispatcher: ssrfSafeDispatcher,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          });
        } catch (e) {
          /**empty**/
        }
      })
    );
  }
  @ActivityMethod()
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  @ActivityMethod()
  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  @ActivityMethod()
  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration);
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration, cause);
      return false;
    }
  }
}
