import { IsString, Matches, MaxLength } from 'class-validator';

export class BillingAppleOfferDto {
  // An App Store product id, e.g. uk.co.postra.app.pro.monthly.
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._-]+$/)
  productId: string;

  // StoreKit's AppTransaction.appTransactionID for this Apple ID and app:
  // Apple signs the eligibility for this customer only.
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9-]+$/)
  appTransactionId: string;
}
