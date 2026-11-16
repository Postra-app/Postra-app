import { IsString, Matches, MaxLength } from 'class-validator';

export class BillingAppleTransactionDto {
  // A JWS: three base64url parts. A signed transaction is a few kilobytes.
  @IsString()
  @MaxLength(20_000)
  @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  signedTransaction: string;
}
