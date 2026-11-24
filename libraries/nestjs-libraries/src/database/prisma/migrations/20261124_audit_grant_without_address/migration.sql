-- A lifetime grant was written to the audit log with the address the
-- administrator typed, beside the ids of the organisations that got it. The
-- ids say who; the address stayed after the account was deleted.
UPDATE "AuditLog"
SET "metadata" = "metadata" - 'email'
WHERE "action" = 'admin.grant-lifetime'
  AND jsonb_exists("metadata", 'email');
