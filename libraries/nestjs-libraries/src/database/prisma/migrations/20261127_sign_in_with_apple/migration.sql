-- Sign in with Apple in the iOS app: accounts made with it have their own
-- provider, and keep the refresh token Apple issued (encrypted) so that
-- deleting the account can revoke the sign-in, as Apple asks. Empty for
-- every other account.
ALTER TYPE "Provider" ADD VALUE IF NOT EXISTS 'APPLE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "appleRefreshToken" TEXT;
