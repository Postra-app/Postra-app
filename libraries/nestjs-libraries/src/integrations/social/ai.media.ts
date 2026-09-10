import { PostDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

/**
 * Does this post carry media that came out of a generative model?
 *
 * YouTube (status.containsSyntheticMedia) and TikTok (post_info.is_aigc) both
 * require the uploader to declare it. Their own detection reads the C2PA
 * marker the model embeds — which every render path we have strips — so the
 * declaration has to come from what we recorded when the file was created.
 *
 * Under-declaring is a policy violation; over-declaring is not. When the user
 * has ticked the platform's own "made with AI" switch, that stands on its own.
 */
export const hasAiGeneratedMedia = (post: PostDetails): boolean =>
  (post?.media ?? []).some((media) => !!media?.aiGenerated);
