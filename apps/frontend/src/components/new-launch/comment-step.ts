// A channel whose first comment is turned on by its owner in a step of their
// own: TikTok, where comments need a second authorization (the channel menu,
// "Enable first comment"). Until then its comments are left out of the post,
// the way they are for a platform with no comments at all, instead of being
// sent and reported as failed. YouTube too: its comment scope is offered only
// where Google's verification allows, and a channel without it has no first
// comment as far as its owner can tell.
export const waitsForCommentStep = (integration?: {
  identifier?: string;
  canComment?: boolean;
}) =>
  ['tiktok', 'youtube'].includes(integration?.identifier || '') &&
  integration?.canComment === false;
