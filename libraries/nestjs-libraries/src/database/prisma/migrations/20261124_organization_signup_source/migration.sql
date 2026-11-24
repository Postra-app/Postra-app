-- The campaign a sign-up came from (utm_source, utm_medium and utm_campaign of
-- the link that led to the sign-up page), kept with the organisation it
-- created. Short labels only, such as "facebook"; empty for every account
-- made without such a link and for all accounts made before this.
ALTER TABLE "Organization" ADD COLUMN "signupSource" TEXT;
ALTER TABLE "Organization" ADD COLUMN "signupMedium" TEXT;
ALTER TABLE "Organization" ADD COLUMN "signupCampaign" TEXT;
