import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import {
  ActivityFailure,
  ApplicationFailure,
  startChild,
  proxyActivities,
  sleep,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { capitalize, sortBy } from 'lodash';
import { PostResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { TypedSearchAttributes } from '@temporalio/common';
import { postId as postIdSearchParam } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

const proxyTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });
};

const {
  getPostsList,
  getPost,
  inAppNotification,
  changeState,
  updatePost,
  clearReleases,
  sendWebhooks,
  isCommentable,
} = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

const poke = defineSignal('poke');

const iterate = Array.from({ length: 5 });

// v1.0.8: a publish failure that isn't bad_body (a timeout, a platform 5xx
// after retries, an SDK error) now tells the user, like bad_body always did,
// instead of only turning the post red (E2E-05-17).
//
// v1.0.7: a channel that can't take comments (provider has commentsDisabled,
// i.e. the platform permission isn't granted) no longer drops them in silence.
// The post still goes out, but the comment rows are marked ERROR with the
// reason and the user is told — instead of those rows sitting in QUEUE forever
// while the published post quietly lacks the comments the composer promised.
//
// v1.0.6 (H1, duplicate posts): postSocial/postComment carry an idempotency
// guard keyed on Post.releaseId, an intentional re-publish (postNow / repeat)
// clears the previous release first, and a generic publish error no longer
// blindly repeats the publish loop — the platform may have accepted the post
// right before the failure.
export async function postWorkflowV108({
  taskQueue,
  postId,
  organizationId,
  postNow = false,
}: {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
}) {
  // Dynamic task queue, for concurrency
  const {
    postSocial,
    postComment,
    getIntegrationById,
    refreshTokenWithCause,
    internalPlugs,
    globalPlugs,
    processInternalPlug,
    processPlug,
  } = proxyTaskQueue(taskQueue);

  let poked = false;
  setHandler(poke, () => {
    poked = true;
  });

  const startTime = new Date();
  // get all the posts and comments to post
  const firstPost = await getPost(organizationId, postId);

  // in case doesn't exists for some reason, fail it
  if (!firstPost) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  if (!postNow && firstPost.state !== 'QUEUE') {
    await changeState(firstPost.id, 'ERROR', 'Already posted', [firstPost]);
    return;
  }

  // if it's a repeatable post, we should ignore this.
  if (!postNow) {
    await sleep(
      dayjs(firstPost.publishDate).isBefore(dayjs())
        ? 0
        : dayjs(firstPost.publishDate).diff(dayjs(), 'millisecond')
    );
  }

  const postsListBefore = await getPostsList(organizationId, postId);
  const [post] = postsListBefore;

  if (!post) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  // if refresh is needed from last time, let's inform the user
  if (post.integration?.refreshNeeded) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
      true,
      false,
      'info'
    );

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Refresh channel needed',
      postsListBefore
    );
    return;
  }

  // if it's disabled, inform the user
  if (post.integration?.disabled) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
      true,
      false,
      'info'
    );

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Channel disabled',
      postsListBefore
    );
    return;
  }

  // Do we need to post comment for this social?
  const toComment: boolean =
    postsListBefore.length === 1
      ? false
      : await isCommentable(post.integration);

  const postsList = toComment ? postsListBefore : [postsListBefore[0]];

  // Comments the user attached that this channel can't publish. They are only
  // reported once the main post is out — if the post itself fails, the error
  // path below already covers the whole group.
  const skippedComments = toComment ? [] : postsListBefore.slice(1);

  // An intentional re-publish (post-now on an already published post, or a
  // repeat-post cycle) must not be blocked by the idempotency guard in
  // postSocial — wipe the previous release so this run starts clean.
  if (postNow) {
    await clearReleases(
      organizationId,
      postsList.map((p) => p.id)
    );
  }

  // list of all the saved results
  const postsResults: PostResponse[] = [];

  // Set when a comment fails after the post itself went out. The post stays
  // published and the run finishes normally; only the comment is flagged.
  let failedComment: { post: (typeof postsList)[number]; err: any } | null =
    null;

  // iterate over the posts
  for (let i = 0; i < postsList.length; i++) {
    const before = postsResults.length;
    // this is a small trick to repeat an action in case of token refresh
    for (const _ of iterate) {
      try {
        // first post the main post
        if (i === 0) {
          postsResults.push(
            ...(await postSocial(post.integration as Integration, [
              postsList[i],
            ]))
          );

          // then post the comments if any
        } else {
          if (postsList[i].delay) {
            await sleep(60000 * Math.max(0, Number(postsList[i].delay ?? 0)));
          }

          postsResults.push(
            ...(await postComment(
              postsResults[0].postId,
              postsResults.length === 1
                ? undefined
                : postsResults[i - 1].postId,
              post.integration,
              [postsList[i]]
            ))
          );
        }

        // mark post as successful
        await updatePost(
          postsList[i].id,
          postsResults[i].postId,
          postsResults[i].releaseURL,
          organizationId
        );

        if (i === 0) {
          // send notification on a sucessful post
          await inAppNotification(
            post.integration.organizationId,
            `Your post has been published on ${capitalize(
              post.integration.providerIdentifier
            )}`,
            `Your post has been published on ${capitalize(
              post.integration.providerIdentifier
            )} at ${postsResults[0].releaseURL}`,
            true,
            true
          );
        }

        // break the current while to move to the next post
        break;
      } catch (err) {
        // if token refresh is needed, do it and repeat
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'refresh_token'
        ) {
          const refresh = await refreshTokenWithCause(
            post.integration,
            err?.cause?.message || ''
          );
          if (!refresh || !refresh.accessToken) {
            await changeState(postsList[0].id, 'ERROR', err, postsList);
            return false;
          }

          post.integration.token = refresh.accessToken;
          continue;
        }

        // A comment that fails must not drag the already-published post into
        // ERROR — it really did go out, and marking the whole group failed is
        // how a successful publish ends up looking broken in the calendar.
        // Stop the chain (later comments reply to this one) and finish the run:
        // webhooks and plugs still belong to a post that exists.
        if (i > 0) {
          failedComment = { post: postsList[i], err };
          break;
        }

        // for other errors, change state and inform the user if needed
        await changeState(postsList[0].id, 'ERROR', err, postsList);

        // specific case for bad body errors
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'bad_body'
        ) {
          await inAppNotification(
            post.organizationId,
            `Error posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            } for ${post?.integration?.name}`,
            `An error occurred while posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            }${err?.cause?.message ? `: ${err?.cause?.message}` : ``}`,
            true,
            false,
            'fail'
          );
          return false;
        }

        // Any other error stops the workflow. The platform may have accepted
        // the post right before the failure (e.g. an activity timeout during
        // a media-processing poll) — blindly repeating the publish loop here
        // is how duplicate posts happened (H1). The post stays in ERROR and
        // the user can retry once they've checked the channel.
        //
        // v1.0.8: until now only bad_body told the user anything; every other
        // failure turned the post red in silence — no bell, no email
        // (E2E-05-17, a Telegram failure on production). Say so, and say to
        // check the channel before retrying, for the reason above.
        const reason =
          (err instanceof ActivityFailure && err.cause?.message) ||
          (err as any)?.message ||
          '';
        await inAppNotification(
          post.organizationId,
          `Error posting on ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
          `We couldn't confirm your post on ${
            post.integration?.providerIdentifier
          }${
            reason ? `: ${String(reason).slice(0, 300)}` : ''
          }. Check the channel before trying again — it may have gone out.`,
          true,
          false,
          'fail'
        );
        return false;
      }
    }

    if (failedComment) {
      break;
    }

    if (postsResults.length === before) {
      // all retries exhausted without success
      return false;
    }
  }

  // The post is out. If the channel couldn't take the comments attached to it,
  // say so and park those rows in ERROR — leaving them in QUEUE made the loss
  // invisible everywhere (no notification, no /admin/errors entry, nothing).
  if (skippedComments.length) {
    const channel = capitalize(post.integration.providerIdentifier);

    for (const comment of skippedComments) {
      await changeState(
        comment.id,
        'ERROR',
        `Comment not published: ${channel} has not granted this channel the permission needed to post comments.`,
        [comment]
      );
    }

    await inAppNotification(
      post.organizationId,
      `Your ${channel} post went out without its comments`,
      `Your post was published on ${channel}, but ${
        skippedComments.length === 1 ? 'the comment' : 'the comments'
      } attached to it could not be — ${channel} has not granted this channel the permission needed to post comments. The text is still saved on the post, so you can add ${
        skippedComments.length === 1 ? 'it' : 'them'
      } on ${channel} yourself.`,
      true,
      false,
      'fail'
    );
  }

  // A comment the channel accepted in principle but the platform rejected in
  // practice. Same treatment: flag the comment, leave the post published.
  if (failedComment) {
    const channel = capitalize(post.integration.providerIdentifier);
    const reason = failedComment.err?.cause?.message
      ? `: ${failedComment.err.cause.message}`
      : '';

    await changeState(failedComment.post.id, 'ERROR', failedComment.err, [
      failedComment.post,
    ]);

    await inAppNotification(
      post.organizationId,
      `Your ${channel} post went out, but a comment didn't`,
      `Your post was published on ${channel}, but one of the comments attached to it could not be posted${reason}. The text is still saved on the post, so you can add it on ${channel} yourself.`,
      true,
      false,
      'fail'
    );
  }

  // send webhooks for the post
  await sendWebhooks(
    postsResults[0].postId,
    post.organizationId,
    post.integration.id
  );

  // load internal plugs like repost by other users
  const internalPlugsList = await internalPlugs(
    post.integration,
    JSON.parse(post.settings)
  );

  // load global plugs, like repost a post if it gets to a certain number of likes
  const globalPlugsList = (await globalPlugs(post.integration)).reduce(
    (all, current) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    },
    []
  );

  // Check if the post is repeatable
  const repeatPost = !post.intervalInDays
    ? []
    : [
        {
          type: 'repeat-post',
          delay:
            post.intervalInDays * 24 * 60 * 60 * 1000 -
            (new Date().getTime() - startTime.getTime()),
        },
      ];

  // Sort all the actions by delay, so we can process them in order
  const list = sortBy(
    [...internalPlugsList, ...globalPlugsList, ...repeatPost],
    'delay'
  );

  // process all the plugs in order, we are using while because in some cases we need to remove items from the list
  while (list.length > 0) {
    // get the next to process
    const todo = list.shift();

    // wait for the delay
    await sleep(Math.max(0, Number(todo.delay ?? 0)));

    // process internal plug
    if (todo.type === 'internal-plug') {
      for (const _ of iterate) {
        try {
          await processInternalPlug({ ...todo, post: postsResults[0].postId });
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshTokenWithCause(
              await getIntegrationById(organizationId, todo.integration),
              err?.cause?.message || ''
            );
            if (!refresh || !refresh.accessToken) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }
        break;
      }
    }

    // process global plug
    if (todo.type === 'global') {
      for (const _ of iterate) {
        try {
          const process = await processPlug({
            ...todo,
            postId: postsResults[0].postId,
          });
          if (process) {
            const toDelete = list
              .reduce((all, current, index) => {
                if (current.plugId === todo.plugId) {
                  all.push(index);
                }

                return all;
              }, [])
              .reverse();

            for (const index of toDelete) {
              list.splice(index, 1);
            }
          }
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshTokenWithCause(
              post.integration,
              err?.cause?.message || ''
            );
            if (!refresh || !refresh.accessToken) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }

        break;
      }
    }

    // process repeat post in a new workflow, this is important so the other plugs can keep running
    if (todo.type === 'repeat-post') {
      await startChild(postWorkflowV108, {
        parentClosePolicy: 'ABANDON',
        args: [
          {
            taskQueue,
            postId,
            organizationId,
            postNow: true,
          },
        ],
        workflowId: `post_${post.id}_${makeId(10)}`,
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: postIdSearchParam,
            value: postId,
          },
        ]),
      });
    }
  }
}
