import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Each of these ends up in the Stripe subscription's metadata, which refuses a
// value over 500 characters; real ones are far shorter.
const TRACKING_MAX = 200;

export class BillingSubscribeDto {
  @IsIn(['MONTHLY', 'YEARLY'])
  period: 'MONTHLY' | 'YEARLY';

  // TEAM is intentionally NOT purchasable: it's a hidden legacy plan (£39/10
  // channels) that undercuts Business (£79). The UI never offered it; this
  // closes the direct-API purchase hole.
  @IsIn(['STANDARD', 'PRO', 'ULTIMATE'])
  billing: 'STANDARD' | 'PRO' | 'ULTIMATE';

  @IsOptional()
  @IsString()
  @MaxLength(TRACKING_MAX)
  utm: string;

  @IsOptional()
  @IsString()
  @MaxLength(TRACKING_MAX)
  dub: string;

  @IsOptional()
  @IsString()
  @MaxLength(TRACKING_MAX)
  datafast_session_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(TRACKING_MAX)
  datafast_visitor_id: string;
}
