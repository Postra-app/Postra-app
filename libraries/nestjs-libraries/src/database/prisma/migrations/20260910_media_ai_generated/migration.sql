-- YouTube (status.containsSyntheticMedia) and TikTok (post_info.is_aigc) both
-- require a post to declare AI-generated media. Their own detection relies on
-- the C2PA marker the image model embeds, and every path we have re-encodes
-- the picture (Studio canvas, branded drafts, thumbnails), which strips it.
-- So we have to remember it ourselves, at the moment the image is created.
--
-- Additive with a default: existing rows are "not declared AI", which is the
-- only safe reading of media whose origin we never recorded.

ALTER TABLE "Media" ADD COLUMN "aiGenerated" BOOLEAN NOT NULL DEFAULT false;
