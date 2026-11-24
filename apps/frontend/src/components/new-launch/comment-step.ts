// A channel whose first comment is turned on by its owner in a step of their
// own. TikTok: comments need a second authorization (the channel menu,
// "Enable first comment"). YouTube: comments need a permission Google grants
// when the channel is connected, so a channel connected without it gets it
// with one reconnect. Until then its comments are left out of the post, the
// way they are for a platform with no comments at all, instead of being sent
// and reported as failed.
type Channel = {
  identifier?: string;
  canComment?: boolean;
  commentSetup?: boolean;
};

export const waitsForCommentStep = (integration?: Channel) =>
  ['tiktok', 'youtube'].includes(integration?.identifier || '') &&
  integration?.canComment === false;

// What the composer tells the owner of such a channel: turn first comment on
// (TikTok, where this workspace is offered it), reconnect so the platform
// grants the permission (YouTube), or nothing to do (TikTok where it is not
// offered).
export const commentStepReason = (
  integration?: Channel
): 'not_enabled' | 'not_granted' | 'no_api' =>
  integration?.identifier === 'youtube'
    ? 'not_granted'
    : integration?.commentSetup
    ? 'not_enabled'
    : 'no_api';
