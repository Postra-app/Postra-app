import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ConflictException, Injectable } from '@nestjs/common';
import { Post as PostBody } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import {
  APPROVED_SUBMIT_FOR_ORDER,
  CreationMethod,
  Post,
  Prisma,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { readablePostError } from '@gitroom/nestjs-libraries/database/prisma/posts/post.error.message';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  redactSecrets,
  redactSecretsInJson,
} from '@gitroom/nestjs-libraries/services/redact.secrets';

dayjs.extend(isoWeek);
dayjs.extend(weekOfYear);
dayjs.extend(isSameOrAfter);
dayjs.extend(utc);

@Injectable()
export class PostsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _popularPosts: PrismaRepository<'popularPosts'>,
    private _comments: PrismaRepository<'comments'>,
    private _tags: PrismaRepository<'tags'>,
    private _tagsPosts: PrismaRepository<'tagsPosts'>,
    private _errors: PrismaRepository<'errors'>,
    private _prismaTransaction: PrismaTransaction
  ) {}

  async getRecentPostBodies(orgId: string, take: number): Promise<string[]> {
    const rows = await this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: { publishDate: 'desc' },
      take,
      select: { content: true },
    });
    return rows.map((r) => r.content).filter((c): c is string => !!c);
  }

  // The window is the last 2 days, whatever the name says. The name matches the
  // Temporal activity in PostActivity, which must keep it (workflow history).
  searchForMissingThreeHoursPosts() {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
          deletedAt: null,
        },
        publishDate: {
          gte: dayjs.utc().subtract(2, 'day').toDate(),
          lt: dayjs.utc().toDate(),
        },
        state: 'QUEUE',
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        organizationId: true,
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
        publishDate: true,
      },
    });
  }

  getOldPosts(orgId: string, date: string) {
    return this._post.model.post.findMany({
      where: {
        integration: {
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        organizationId: orgId,
        publishDate: {
          lte: dayjs(date).toDate(),
        },
        deletedAt: null,
        parentPostId: null,
      },
      orderBy: {
        publishDate: 'desc',
      },
      // Bounded: an org with years of autoposts would otherwise get a
      // full-table-slice JSON response.
      take: 200,
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }

  // Filling in a media path (or swapping a PNG for a JPEG) is not an edit.
  // Through Prisma it bumped `updatedAt`, so the editor whose opening of the
  // post triggered it held a version that already looked stale, and its first
  // save was refused with a 409 (E2E-05-40). Raw SQL because Prisma sets
  // @updatedAt on every update it makes.
  updateImages(id: string, images: string) {
    return this._prismaTransaction.model.$transaction(
      (tx) => tx.$executeRaw`UPDATE "Post" SET "image" = ${images} WHERE "id" = ${id}`
    );
  }

  getPostUrls(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        releaseURL: true,
      },
    });
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    // Clamp the window: an arbitrary client-supplied range would fetch the
    // whole table and drive the recurrence expansion below unbounded. 370
    // days covers every calendar view (day/week/month/year).
    const startDate = dayjs.utc(query.startDate).toDate();
    const requestedEnd = dayjs.utc(query.endDate);
    const maxEnd = dayjs.utc(query.startDate).add(370, 'day');
    const endDate = (
      requestedEnd.isAfter(maxEnd) ? maxEnd : requestedEnd
    ).toDate();

    const list = await this._post.model.post.findMany({
      where: {
        AND: [
          {
            OR: [
              {
                organizationId: orgId,
              },
            ],
          },
          {
            OR: [
              {
                publishDate: {
                  gte: startDate,
                  lte: endDate,
                },
              },
              {
                intervalInDays: {
                  not: null,
                },
              },
            ],
          },
        ],
        // The customer filter used to replace this whole object, so a
        // customer's view also listed posts of deleted channels (upstream
        // 81547fc6).
        integration: {
          deletedAt: null,
          organizationId: orgId,
          ...(query.customer ? { customerId: query.customer } : {}),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        releaseId: true,
        state: true,
        error: true,
        intervalInDays: true,
        group: true,
        creationMethod: true,
        tags: {
          where: { tag: { deletedAt: null } },
          select: {
            tag: true,
          },
        },
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
            name: true,
            picture: true,
          },
        },
      },
    });

    // The calendar tooltip, the public API and the agent's post list all said
    // only "an error occurred": the error column was never selected (upstream
    // 291b07b4, c8bf9d8f). Post.error holds the raw Temporal failure; callers
    // get its sentence, the full trace stays in the Errors table.
    const readable = list.map((post) => ({
      ...post,
      error: readablePostError(post.error),
    }));

    return readable.reduce((all, post) => {
      if (!post.intervalInDays) {
        return [...all, post];
      }

      const addMorePosts = [];
      const interval = Math.max(1, post.intervalInDays);
      const windowStart = dayjs.utc(startDate);
      let startingDate = dayjs.utc(post.publishDate);
      // Fast-forward to the first occurrence inside the window instead of
      // materializing every occurrence since the post was created.
      if (startingDate.isBefore(windowStart)) {
        const skipped = Math.ceil(
          windowStart.diff(startingDate, 'day', true) / interval
        );
        startingDate = startingDate.add(skipped * interval, 'days');
      }
      while (dayjs.utc(endDate).isSameOrAfter(startingDate)) {
        addMorePosts.push({
          ...post,
          publishDate: startingDate.toDate(),
          actualDate: post.publishDate,
        });

        startingDate = startingDate.add(interval, 'days');
      }

      return [...all, ...addMorePosts];
    }, [] as any[]);
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    const page = query.page || 0;
    const limit = query.limit || 20;
    const skip = page * limit;

    const stateFilter = query.state || 'all';
    const stateAndDate =
      stateFilter === 'scheduled'
        ? {
            state: State.QUEUE,
          }
        : stateFilter === 'draft'
        ? { state: State.DRAFT }
        : stateFilter === 'published'
        ? { state: State.PUBLISHED }
        : stateFilter === 'error'
        ? { state: State.ERROR }
        : {
            state: {
              in: [State.QUEUE, State.DRAFT, State.PUBLISHED, State.ERROR],
            },
          };

    // A post is only in PUBLISHED or ERROR once the publish attempt has already
    // happened, so its publishDate is always in the past. Any filter that can
    // contain one therefore has to skip the "upcoming" date filter below and
    // read newest-first.
    //
    // ⛔ `all` belongs in that set and did not use to be, which is how a filter
    // labelled "All" came to answer 55 of 111 rows. It already
    // listed every state — the date filter then cut the past ones straight back
    // out. Measured on production 2026-09-20: `state=all` → 55, every row QUEUE,
    // while `state=published` alone returned 53 and three more sat in ERROR.
    // This is the web's default list tab, so the label was lying to every user,
    // not just to the phone.
    //
    // `draft` too: a draft has not been scheduled, and the date picker lets a
    // draft carry a past date — under the upcoming filter it vanished from the
    // Draft tab it was saved into.
    const includesThePast =
      stateFilter === 'published' ||
      stateFilter === 'error' ||
      stateFilter === 'draft' ||
      stateFilter === 'all';

    // Newest first once the past is in scope: ascending would put last July on
    // page 1 and bury everything the user actually has coming up.
    const orderDirection: 'asc' | 'desc' = includesThePast ? 'desc' : 'asc';

    const where = {
      AND: [
        {
          OR: [
            {
              organizationId: orgId,
            },
          ],
        },
      ],
      ...stateAndDate,
      ...(includesThePast ? {} : { publishDate: { gte: dayjs.utc().toDate() } }),
      deletedAt: null as Date | null,
      parentPostId: null as string | null,
      // Repeating posts used to be filtered out here, so a weekly post never
      // showed in any List tab — the phone's default view.

      integration: {
        deletedAt: null as any,
        organizationId: orgId,
        ...(query.customer
          ? {
              customerId: query.customer,
            }
          : {}),
        ...(query.integrations
          ? {
              id: { in: query.integrations },
            }
          : {}),
      },
    };

    const [posts, total] = await Promise.all([
      this._post.model.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          publishDate: orderDirection,
        },
        select: {
          id: true,
          content: true,
          publishDate: true,
          releaseURL: true,
          releaseId: true,
          state: true,
          intervalInDays: true,
          group: true,
          creationMethod: true,
          tags: {
            where: { tag: { deletedAt: null } },
            select: {
              tag: true,
            },
          },
          integration: {
            select: {
              id: true,
              providerIdentifier: true,
              name: true,
              picture: true,
            },
          },
        },
      }),
      this._post.model.post.count({ where }),
    ]);

    return {
      posts,
      total,
      page,
      limit,
      hasMore: skip + posts.length < total,
    };
  }

  async deletePost(orgId: string, group: string) {
    // Only live rows: without `deletedAt: null` a second delete of the same
    // group re-stamped deletedAt and still returned the post, so the caller
    // was told "deleted" for a post that had been gone for hours.
    const { count } = await this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (!count) {
      return null;
    }

    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
      },
      select: {
        id: true,
      },
    });
  }

  // The posts of the other channels saved in the same batch, without the
  // given group.
  getPostsByBatch(orgId: string, batchId: string, exceptGroup: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        batchId,
        group: { not: exceptGroup },
        deletedAt: null,
        integration: { deletedAt: null },
      },
      include: {
        integration: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  getPostsByGroup(orgId: string, group: string) {
    return this._post.model.post.findMany({
      where: {
        group,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        integration: true,
        tags: {
          where: { tag: { deletedAt: null } },
          select: {
            tag: true,
          },
        },
      },
    });
  }

  // One query for a whole thread chain (getPostsRecursively used to issue one
  // getPost per part). Children never need the integration relation.
  getPostsChain(group: string, orgId?: string) {
    return this._post.model.post.findMany({
      where: {
        group,
        deletedAt: null,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      include: {
        childrenPost: true,
      },
    });
  }

  getPost(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ) {
    return this._post.model.post.findUnique({
      where: {
        id,
        ...(orgId ? { organizationId: orgId } : {}),
        deletedAt: null,
      },
      include: {
        ...(includeIntegration
          ? {
              integration: true,
              tags: {
                where: { tag: { deletedAt: null } },
                select: {
                  tag: true,
                },
              },
            }
          : {}),
        childrenPost: true,
      },
    });
  }

  updatePost(id: string, postId: string, releaseURL: string, orgId?: string) {
    return this._post.model.post.update({
      where: {
        id,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      data: {
        state: 'PUBLISHED',
        releaseURL,
        releaseId: postId,
      },
    });
  }

  // By id, not by group: every save moves the posts to a new group.
  async refuseIfChangedSince(
    orgId: string,
    ids: string[],
    expectedUpdatedAt: string
  ) {
    const { _max } = await this._post.model.post.aggregate({
      _max: { updatedAt: true },
      where: { organizationId: orgId, id: { in: ids } },
    });
    this.refuseIfNewer(_max.updatedAt, expectedUpdatedAt);
  }

  // First thing in a save's transaction: lock every post it overwrites, in
  // one fixed order, until it commits. Checked only before the write, two
  // saves opened from the same version both passed and the later replaced
  // the earlier without a 409 (E2E-05-39); locked post by post as the writes
  // went, [A, B] and [B, A] at once deadlocked and one got a 500
  // (E2E-05-42). Now the second save waits for the first, then sees its
  // version.
  async lockForSave(
    tx: Prisma.TransactionClient,
    orgId: string,
    ids: string[],
    expectedUpdatedAt?: string
  ) {
    if (!ids.length) {
      return;
    }

    const rows = await tx.$queryRaw<{ updatedAt: Date }[]>`
      SELECT "updatedAt" FROM "Post"
      WHERE "id" = ANY(${ids}::text[]) AND "organizationId" = ${orgId}
      ORDER BY "id"
      FOR UPDATE`;

    if (expectedUpdatedAt) {
      const latest = rows.reduce<Date | null>(
        (max, { updatedAt }) => (!max || updatedAt > max ? updatedAt : max),
        null
      );
      this.refuseIfNewer(latest, expectedUpdatedAt);
    }
  }

  private refuseIfNewer(latest: Date | null, expectedUpdatedAt: string) {
    if (latest && latest.getTime() > Date.parse(expectedUpdatedAt)) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Someone else saved changes to this post after you opened it.',
        updatedAt: latest.toISOString(),
      });
    }
  }


  clearReleases(orgId: string, ids: string[]) {
    return this._post.model.post.updateMany({
      where: {
        id: { in: ids },
        organizationId: orgId,
      },
      data: {
        releaseId: null,
        releaseURL: null,
      },
    });
  }

  // null unless the post is this org's and still waiting for its release id —
  // a plain update threw P2025 for every other post, a 500.
  async updateReleaseId(id: string, orgId: string, releaseId: string) {
    const { count } = await this._post.model.post.updateMany({
      where: {
        id,
        organizationId: orgId,
        releaseId: 'missing',
      },
      data: {
        releaseId,
      },
    });
    return count ? { id, releaseId } : null;
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    const update = await this._post.model.post.update({
      where: {
        id,
      },
      data: {
        state,
        // The twin of this value — `Errors.message`, written a few lines down —
        // is redacted before it is stored, because a provider's failure payload
        // can carry the plaintext token the publish was using.
        // `Post.error` was not, and the web calendar already has a tooltip
        // reading `post.error`, so the moment that field is selected into a
        // response it becomes the same leak by a different door.
        ...(err
          ? {
              error: redactSecretsInJson(
                typeof err === 'string' ? err : JSON.stringify(err)
              ),
            }
          : {}),
      },
      include: {
        integration: {
          select: {
            providerIdentifier: true,
          },
        },
      },
    });

    if (state === 'ERROR' && err && body) {
      try {
        // `body` is the post list the workflow was holding when publishing
        // failed, and every post in it carries its full Integration row because
        // publishing needs the token. Providers that refresh (Instagram,
        // YouTube) write a plaintext access token back onto that same object,
        // so the row would otherwise land here as a working credential — shown
        // by "View" and copied by "Copy Debug Code" in the admin panel.
        // E2E-09-01.
        await this._errors.model.errors.create({
          data: {
            message: redactSecretsInJson(
              typeof err === 'string' ? err : JSON.stringify(err)
            ),
            organizationId: update.organizationId,
            platform: update.integration.providerIdentifier,
            postId: update.id,
            body:
              typeof body === 'string'
                ? redactSecretsInJson(body)
                : JSON.stringify(redactSecrets(body)),
          },
        });
      } catch (err) {}
    }

    return update;
  }

  getErrorsByPostIds(postIds: string[]) {
    return this._errors.model.errors.findMany({
      where: {
        postId: { in: postIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    isDraft: boolean,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    return this._post.model.post.update({
      where: {
        organizationId: orgId,
        id,
      },
      data: {
        publishDate: dayjs(date).toDate(),
        // schedule: set state to QUEUE (or DRAFT if it was a draft)
        // update: don't change the state
        ...(action === 'schedule'
          ? {
              state: isDraft ? 'DRAFT' : 'QUEUE',
              releaseId: null,
              releaseURL: null,
            }
          : {}),
      },
    });
  }

  /**
   * The channels among `integrationIds` that already have an Auto Post post
   * for this article, made lately. The link has to end where the article's
   * does: `…/posts/1` must not match a post for `…/posts/10`.
   */
  async channelsWithRecentAutopost(
    orgId: string,
    integrationIds: string[],
    url: string
  ) {
    const forms = [url, url.replace(/&/g, '&amp;')];
    const rows = await this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        creationMethod: 'AUTOPOST',
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        OR: forms.flatMap((form) => [
          { content: { endsWith: form } },
          ...['<', '\n', ' ', '"'].map((next) => ({
            content: { contains: form + next },
          })),
        ]),
      },
      select: { integrationId: true },
      distinct: ['integrationId'],
    });
    return new Set(rows.map((row) => row.integrationId));
  }

  clearGroupReleases(orgId: string, group: string) {
    return this._post.model.post.updateMany({
      where: { organizationId: orgId, group, deletedAt: null },
      data: { releaseId: null, releaseURL: null },
    });
  }

  countExistingPosts(orgId: string, ids: string[]) {
    return this._post.model.post.count({
      where: { organizationId: orgId, id: { in: ids }, deletedAt: null },
    });
  }

  // What counts against the monthly cap: scheduled and published posts, by
  // publish date, inside [start, end); of `ids`, only those already counted.
  countCountedPosts(orgId: string, start: Date, end: Date, ids?: string[]) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        ...(ids ? { id: { in: ids } } : {}),
        publishDate: { gte: start, lt: end },
        OR: [
          { deletedAt: null, state: { in: ['QUEUE'] } },
          { state: 'PUBLISHED' },
        ],
      },
    });
  }

  countPostsFromDay(orgId: string, date: Date) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: date,
        },
        OR: [
          {
            deletedAt: null,
            state: {
              in: ['QUEUE'],
            },
          },
          {
            state: 'PUBLISHED',
          },
        ],
      },
    });
  }

  async createOrUpdatePost(
    state: 'draft' | 'schedule' | 'now' | 'update',
    orgId: string,
    date: string,
    body: PostBody,
    tags: { value: string; label: string }[],
    creationMethod: CreationMethod,
    inter?: number,
    outer?: Prisma.TransactionClient,
    // Shared by the posts saved together for several channels, so opening one
    // of them in the editor brings the others.
    batchId?: string
  ) {
    // Creating a thread is a multi-step write (per-part upserts, tag rewrite,
    // soft-delete of the previous group). A failure mid-way used to leave a
    // half-created thread with the old group still live — all-or-nothing now,
    // and inside the caller's transaction when a save spans several channels.
    const write = async (tx: Prisma.TransactionClient) => {
    const posts: Post[] = [];
    const uuid = uuidv4();

    // An edited post stays in the batch it was created in, also when it is
    // saved on its own. Read before the writes below give it a new group.
    const ids = body.value.map((value) => value.id).filter(Boolean) as string[];
    const existingBatchId =
      body.group || ids.length
        ? (
            await tx.post.findFirst({
              where: {
                organizationId: orgId,
                deletedAt: null,
                batchId: { not: null },
                OR: [
                  ...(body.group ? [{ group: body.group }] : []),
                  ...(ids.length ? [{ id: { in: ids } }] : []),
                ],
              },
              select: { batchId: true },
            })
          )?.batchId
        : undefined;

    for (const value of body.value) {
      const updateData = (type: 'create' | 'update') => ({
        publishDate: dayjs(date).toDate(),
        integration: {
          connect: {
            id: body.integration.id,
            organizationId: orgId,
          },
        },
        ...(posts?.[posts.length - 1]?.id
          ? {
              parentPost: {
                connect: {
                  id: posts[posts.length - 1]?.id,
                },
              },
            }
          : type === 'update'
          ? {
              parentPost: {
                disconnect: true,
              },
            }
          : {}),
        content: value.content,
        delay: value.delay || 0,
        group: uuid,
        batchId: existingBatchId || batchId || null,
        intervalInDays: inter && +inter >= 1 ? Math.floor(+inter) : null,
        approvedSubmitForOrder: APPROVED_SUBMIT_FOR_ORDER.NO,
        ...(type === 'create' ? { creationMethod } : {}),
        ...(state === 'update'
          ? {}
          : {
              state:
                state === 'draft' ? ('DRAFT' as const) : ('QUEUE' as const),
            }),
        image: JSON.stringify(value.image),
        settings: JSON.stringify(body.settings),
        organization: {
          connect: {
            id: orgId,
          },
        },
      });

      posts.push(
        await tx.post.upsert({
          where: {
            id: value.id || uuidv4(),
            organizationId: orgId,
          },
          create: { ...updateData('create') },
          update: {
            ...updateData('update'),
            lastMessage: {
              disconnect: true,
            },
            submittedForOrder: {
              disconnect: true,
            },
          },
        })
      );

      if (posts.length === 1) {
        await tx.tagsPosts.deleteMany({
          where: {
            post: {
              id: posts[0].id,
            },
          },
        });

        if (tags.length) {
          const tagsList = await tx.tags.findMany({
            where: {
              orgId: orgId,
              // A deleted tag of the same name was attached too, unseen.
              deletedAt: null,
              name: {
                in: tags.map((tag) => tag.label).filter((f) => f),
              },
            },
          });

          if (tagsList.length) {
            await tx.post.update({
              where: {
                id: posts[posts.length - 1].id,
              },
              data: {
                tags: {
                  createMany: {
                    data: tagsList.map((tag) => ({
                      tagId: tag.id,
                    })),
                  },
                },
              },
            });
          }
        }
      }
    }

    const previousPost = body.group
      ? (
          await tx.post.findFirst({
            where: {
              group: body.group,
              organizationId: orgId,
              deletedAt: null,
              parentPostId: null,
            },
            select: {
              id: true,
            },
          })
        )?.id!
      : undefined;

    if (body.group) {
      await tx.post.updateMany({
        where: {
          group: body.group,
          organizationId: orgId,
          deletedAt: null,
        },
        data: {
          parentPostId: null,
          deletedAt: new Date(),
        },
      });
    }

    return { previousPost, posts };
    };

    return outer ? write(outer) : this._prismaTransaction.model.$transaction(write);
  }

  // A whole save, every channel of it, commits or fails together. Generous
  // timeout: a save of many channels with threads is a few hundred writes.
  transaction<T>(write: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this._prismaTransaction.model.$transaction(write, {
      timeout: 30_000,
    });
  }

  async submit(id: string, order: string, buyerOrganizationId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        submittedForOrderId: order,
        approvedSubmitForOrder: 'WAITING_CONFIRMATION',
        submittedForOrganizationId: buyerOrganizationId,
      },
      select: {
        id: true,
        description: true,
        submittedForOrder: {
          select: {
            messageGroupId: true,
          },
        },
      },
    });
  }

  updateMessage(id: string, messageId: string) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastMessageId: messageId,
      },
    });
  }

  getPostById(id: string, org?: string) {
    return this._post.model.post.findUnique({
      where: {
        id,
        deletedAt: null,
        ...(org ? { organizationId: org } : {}),
      },
      include: {
        integration: true,
        submittedForOrder: {
          include: {
            posts: {
              where: {
                state: 'PUBLISHED',
              },
            },
            ordersItems: true,
            seller: {
              select: {
                id: true,
                account: true,
              },
            },
          },
        },
      },
    });
  }

  findAllExistingCategories() {
    return this._popularPosts.model.popularPosts.findMany({
      select: {
        category: true,
      },
      distinct: ['category'],
    });
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
      },
      select: {
        topic: true,
      },
      distinct: ['topic'],
    });
  }

  findPopularPosts(category: string, topic?: string) {
    return this._popularPosts.model.popularPosts.findMany({
      where: {
        category,
        ...(topic ? { topic } : {}),
      },
      select: {
        content: true,
        hook: true,
      },
    });
  }

  createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._popularPosts.model.popularPosts.create({
      data: {
        category: 'category',
        topic: 'topic',
        content: 'content',
        hook: 'hook',
      },
    });
  }

  async getPostsCountsByDates(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ) {
    const dates = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        publishDate: {
          in: times.map((time) => {
            return date.clone().add(time, 'minutes').toDate();
          }),
        },
      },
    });

    return times.filter(
      (time) =>
        date.clone().add(time, 'minutes').isAfter(dayjs.utc()) &&
        !dates.find((dateFind) => {
          return (
            dayjs
              .utc(dateFind.publishDate)
              .diff(date.clone().startOf('day'), 'minutes') == time
          );
        })
    );
  }

  async getComments(postId: string) {
    return this._comments.model.comments.findMany({
      where: {
        postId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getTags(orgId: string) {
    return this._tags.model.tags.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._tags.model.tags.create({
      data: {
        orgId,
        name: body.name,
        color: body.color,
      },
    });
  }

  // updateMany, not update: update throws on a missing row (an unknown id or
  // another org's tag answered 500) and happily edited a deleted tag. Both
  // return null when nothing of this org matched.
  async editTag(id: string, orgId: string, body: CreateTagDto) {
    const { count } = await this._tags.model.tags.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { name: body.name, color: body.color },
    });
    return count ? this._tags.model.tags.findUnique({ where: { id } }) : null;
  }

  async deleteTag(id: string, orgId: string) {
    const { count } = await this._tags.model.tags.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!count) {
      return null;
    }
    // Posts keep no link to a deleted tag (upstream 8d81cacd).
    await this._tagsPosts.model.tagsPosts.deleteMany({ where: { tagId: id } });
    return this._tags.model.tags.findUnique({ where: { id } });
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    content: string
  ) {
    return this._comments.model.comments.create({
      data: {
        organizationId: orgId,
        userId,
        postId,
        content,
      },
    });
  }

  async getPostByForWebhookId(postId: string, integrationId: string) {
    const select = {
      id: true,
      content: true,
      publishDate: true,
      releaseURL: true,
      state: true,
      integration: {
        select: {
          id: true,
          name: true,
          providerIdentifier: true,
          picture: true,
          type: true,
        },
      },
    };
    const posts = await this._post.model.post.findMany({
      where: { id: postId, deletedAt: null, parentPostId: null },
      select,
    });
    if (posts.length) {
      return posts;
    }

    // The workflows pass the platform's post id, which updatePost has
    // already stored as releaseId — looked up by our id alone, every webhook
    // body was [] (upstream b1930421).
    return this._post.model.post.findMany({
      where: { releaseId: postId, integrationId, deletedAt: null, parentPostId: null },
      orderBy: { updatedAt: 'desc' },
      take: 1,
      select,
    });
  }

  async getPostsSince(orgId: string, since: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        publishDate: {
          gte: new Date(since),
        },
        deletedAt: null,
        parentPostId: null,
      },
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseURL: true,
        state: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            type: true,
          },
        },
      },
    });
  }
}
