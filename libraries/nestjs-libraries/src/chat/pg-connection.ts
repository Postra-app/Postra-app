// The shared DATABASE_URL says sslmode=require, which Prisma needs as it is.
// pg reads `require` as verify-full today and will read it as libpq's
// "encrypt, don't verify" from pg 9 (its startup warning says so). The RDS CA
// is trusted through NODE_EXTRA_CA_CERTS (Dockerfile.dev), so pg pools ask for
// full verification by name and keep it after that change.
export const pgConnectionString = (url: string) =>
  url.replace(/([?&])sslmode=require(?=&|$)/, '$1sslmode=verify-full');
