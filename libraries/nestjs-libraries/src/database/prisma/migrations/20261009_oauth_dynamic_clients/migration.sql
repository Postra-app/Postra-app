-- ChatGPT and Claude connectors: dynamic OAuth clients (RFC 7591).
ALTER TABLE "OAuthApp" ALTER COLUMN "organizationId" DROP NOT NULL;
ALTER TABLE "OAuthApp" ALTER COLUMN "clientSecret" DROP NOT NULL;
ALTER TABLE "OAuthApp" ADD COLUMN "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OAuthApp" ADD COLUMN "dynamic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OAuthApp" ADD COLUMN "tokenEndpointAuthMethod" TEXT;
CREATE INDEX "OAuthApp_dynamic_idx" ON "OAuthApp"("dynamic");
ALTER TABLE "OAuthAuthorization" ADD COLUMN "redirectUri" TEXT;
