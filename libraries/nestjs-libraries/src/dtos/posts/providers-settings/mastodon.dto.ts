import { IsIn, IsOptional } from 'class-validator';

// Who can see the post on Mastodon. Every post went out public before
// (K32, 2026-10-10); public stays the default.
export const MASTODON_VISIBILITY = ['public', 'unlisted', 'private'] as const;

export class MastodonDto {
  @IsIn(MASTODON_VISIBILITY)
  @IsOptional()
  visibility?: (typeof MASTODON_VISIBILITY)[number];
}
