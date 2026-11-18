// A channel whose first comment is turned on by its owner in a step of their
// own: TikTok, where comments need a second authorization (the channel menu,
// "Enable first comment"). Until then its comments are left out of the post,
// the way they are for a platform with no comments at all, instead of being
// sent and reported as failed.
export const waitsForCommentStep = (integration?: {
  identifier?: string;
  canComment?: boolean;
}) => integration?.identifier === 'tiktok' && integration?.canComment === false;
