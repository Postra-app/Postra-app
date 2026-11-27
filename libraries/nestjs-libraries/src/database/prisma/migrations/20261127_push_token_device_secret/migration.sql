-- The hash of the app's per-install secret, which lets a push token move to
-- the next account signed in on the same phone. Empty for
-- tokens registered by older app builds; they keep the old rule.
ALTER TABLE "MobilePushToken" ADD COLUMN IF NOT EXISTS "deviceSecretHash" TEXT;
