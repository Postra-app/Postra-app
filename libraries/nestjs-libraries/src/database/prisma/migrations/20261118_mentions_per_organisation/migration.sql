-- Mention suggestions are now cached per organisation ("platform:orgId").
-- The rows cached for every organisation at once can no longer be read and
-- hold other organisations' lookups (members of their Discord servers), so
-- they go. Data only: the table itself does not change.
DELETE FROM "Mentions" WHERE "platform" NOT LIKE '%:%';
