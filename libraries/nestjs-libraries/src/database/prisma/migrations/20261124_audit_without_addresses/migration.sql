-- Audit rows name people by id. The address was copied into these rows as
-- well and stayed there after the account was deleted; the id is enough while
-- the account exists, and nothing personal should remain once it does not.
UPDATE "AuditLog"
SET "metadata" = "metadata" - 'email'
WHERE jsonb_exists("metadata", 'email')
  AND "action" IN (
    'auth.register',
    'auth.login',
    'admin.grant-admin',
    'admin.revoke-admin',
    'admin.suspend-user',
    'admin.unsuspend-user',
    'admin.export-user',
    'admin.delete-user'
  );

-- A failed sign-in has no id, only the address typed. Kept for an existing
-- account (someone guessing at it); removed where no account has the address.
UPDATE "AuditLog" a
SET "metadata" = a."metadata" - 'email'
WHERE a."action" = 'auth.login.failed'
  AND jsonb_exists(a."metadata", 'email')
  AND NOT EXISTS (
    SELECT 1 FROM "User" u WHERE lower(u."email") = lower(a."metadata"->>'email')
  );
