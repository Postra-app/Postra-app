-- A second factor for Postra administrators (User.isSuperAdmin): the
-- authenticator secret, encrypted, and hashed backup codes. Additive.
CREATE TABLE "UserTotp" (
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3),
    "lastStep" INTEGER,
    "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTotp_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserTotp" ADD CONSTRAINT "UserTotp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
