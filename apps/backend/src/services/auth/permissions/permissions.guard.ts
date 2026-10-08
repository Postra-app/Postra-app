import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AppAbility,
  PermissionsService,
} from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  AbilityPolicy,
  CHECK_POLICIES_KEY,
} from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { Organization } from '@prisma/client';
import { saveTypeOfPost } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { Request } from 'express';
import {
  PermissionDeniedException,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

// Sign-in routes and the channel-connect callbacks run before there is an
// organisation to check against. Matched as a prefix: the old substring test
// let anything containing "/auth" through, so `/oauth/authorize` — approving an
// app that then acts as an admin — skipped every policy (E2E-08-25).
export const isUnguardedPath = (path: string) =>
  path === '/auth' ||
  path.startsWith('/auth/') ||
  path.startsWith('/integrations/social-connect') ||
  path.startsWith('/integrations/provider');

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private _reflector: Reflector,
    private _authorizationService: PermissionsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    if (isUnguardedPath(request.path)) {
      return true;
    }

    const policyHandlers =
      this._reflector.get<AbilityPolicy[]>(
        CHECK_POLICIES_KEY,
        context.getHandler()
      ) || [];

    if (!policyHandlers || !policyHandlers.length) {
      return true;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const { org }: { org: Organization } = request;

    const refreshChannelId = typeof request.query?.refresh === 'string' ? request.query.refresh : undefined;
    // Drafts do not count towards the monthly post cap.
    // `status` is the body of PUT /posts/:id/status only; a create carries
    // `type`, and a stray `status: 'draft'` next to it must not make it free.
    // By the path alone: a query string could carry "/public/v1/" (Codex).
    const path = String(request.originalUrl || request.url || '').split('?')[0];
    const publicApi = /(^|\/)public\/v1\//.test(path);
    // The editor saves each channel with its own type; the public API uses
    // the request's type for every channel (it drops a per-channel one).
    const typeOf = (post: any) =>
      publicApi ? request.body?.type : saveTypeOfPost(request.body, post);
    const bodyPosts: any[] = Array.isArray(request.body?.posts)
      ? request.body.posts
      : [];
    const isDraft = bodyPosts.length
      ? bodyPosts.every((post) => typeOf(post) === 'draft')
      : request.body?.type === 'draft' ||
        (request.body?.type === undefined && request.body?.status === 'draft');

    // Every channel and every thread part of a save is a post against the
    // monthly cap; the check used to let one request through for any count
    // below it (BILL-4, POSTS-12). Ids that already exist are edits.
    // Each with the date it is saved on, so it counts against that billing
    // month ("now" posts against this one). The public API saves every post
    // on the request date (it drops a per-channel one).
    const at = (post: any) =>
      typeOf(post) === 'now'
        ? new Date().toISOString()
        : [publicApi ? undefined : post?.date, request.body?.date].find(
            (d) => typeof d === 'string' && !Number.isNaN(Date.parse(d))
          );
    // Channels kept as drafts are not posts against the cap.
    const saved = bodyPosts
      .filter((p: any) => typeOf(p) !== 'draft')
      .flatMap((p: any) =>
        (Array.isArray(p?.value) ? p.value : []).map((v: any) => ({
          id: typeof v?.id === 'string' && v.id ? v.id : undefined,
          date: at(p),
        }))
      );
    // A status change (PUT /posts/:id/status) schedules that one post, which
    // counts against the month of its own publish date.
    const changed =
      !saved.length && typeof request.params?.id === 'string'
        ? [{ id: request.params.id }]
        : [];
    const postsRequested = { posts: saved.length ? saved : changed };

    // @ts-ignore
    const ability = await this._authorizationService.check(org.id, org.createdAt, org.users[0].role, policyHandlers, refreshChannelId, org.isTrailing, isDraft, postsRequested);

    const item = policyHandlers.find(
      (handler) => !this.execPolicyHandler(handler, ability)
    );

    if (item) {
      const denial = { section: item[1], action: item[0] };

      // A role that is too low is a 403, not a 402 — see
      // PermissionDeniedException. Keeping both on 402 made the two cases
      // indistinguishable from the outside, which is also why the role matrix
      // could not be verified from status codes.
      throw item[1] === Sections.ADMIN
        ? new PermissionDeniedException(denial)
        : new SubscriptionException(denial);
    }

    return true;
  }

  private execPolicyHandler(handler: AbilityPolicy, ability: AppAbility) {
    return ability.can(handler[0], handler[1]);
  }
}
