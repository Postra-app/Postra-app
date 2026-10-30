// Stored secrets are encrypted under TOKEN_ENCRYPTION_KEYS, or a key derived
// from JWT_SECRET, and the app refuses to run with neither. CI has neither
// (locally Prisma Client loads them from .env), so every spec file starts
// with a fixed test key; specs about the keys set their own.
process.env.TOKEN_ENCRYPTION_KEYS ||= 'test:jest-only-not-a-secret-0123456789abcdef';
