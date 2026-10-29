import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const AUTOCOMPLETE_SURFACES = ['signature', 'post'] as const;
export type AutocompleteSurface = (typeof AUTOCOMPLETE_SURFACES)[number];

// Ghost text while typing. The surface picks the prompt on the server; the
// text around the cursor is all the browser sends.
export class AutocompleteDto {
  @IsIn(AUTOCOMPLETE_SURFACES)
  surface: AutocompleteSurface;

  @IsString()
  @MaxLength(10_000)
  before: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  after?: string;
}
