import {
  IsBoolean,
  ValidateIf,
  IsIn,
  IsString,
  MaxLength,
  IsOptional,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// TikTok Direct Post guidelines: once the creator discloses commercial content
// they must say whose it is, and branded content can't be posted as private.
// Upload-only finishes inside the TikTok app, where TikTok asks for this itself.
@ValidatorConstraint({ name: 'TikTokDisclosureChoice', async: false })
class TikTokDisclosureChoiceConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const o = args.object as TikTokDto;
    if (o.content_posting_method === 'UPLOAD' || !o.disclose) return true;
    return !!o.brand_organic_toggle || !!o.brand_content_toggle;
  }

  defaultMessage() {
    return 'You need to indicate if your content promotes yourself, a third party, or both.';
  }
}

@ValidatorConstraint({ name: 'TikTokBrandedNotPrivate', async: false })
class TikTokBrandedNotPrivateConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const o = args.object as TikTokDto;
    if (o.content_posting_method === 'UPLOAD' || !o.brand_content_toggle) {
      return true;
    }
    return o.privacy_level !== 'SELF_ONLY';
  }

  defaultMessage() {
    return 'Branded content visibility cannot be set to private.';
  }
}

export class TikTokDto {
  @ValidateIf((p) => p.title)
  @MaxLength(90)
  title: string;

  @IsIn([
    'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR',
    'SELF_ONLY',
  ])
  @IsString()
  privacy_level:
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY';

  @IsBoolean()
  duet: boolean;

  @IsBoolean()
  stitch: boolean;

  @IsBoolean()
  comment: boolean;

  @IsIn(['yes', 'no'])
  autoAddMusic: 'yes' | 'no';

  @IsBoolean()
  @IsOptional()
  disclose?: boolean;

  @IsBoolean()
  @Validate(TikTokBrandedNotPrivateConstraint)
  brand_content_toggle: boolean;

  @IsBoolean()
  @IsOptional()
  video_made_with_ai: boolean;

  @IsBoolean()
  @Validate(TikTokDisclosureChoiceConstraint)
  brand_organic_toggle: boolean;

  @IsIn(['DIRECT_POST', 'UPLOAD'])
  @IsString()
  content_posting_method: 'DIRECT_POST' | 'UPLOAD';
}
