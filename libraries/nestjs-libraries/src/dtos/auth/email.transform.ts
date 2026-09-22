import { Transform } from 'class-transformer';

// Accounts are stored with a lower-cased email, so every form that takes one
// has to read it the same way. Signing in used the raw value: an address
// registered as `Kris@Example.com` could not sign in as typed, and one pasted
// with a trailing space failed validation outright (E2E-03-01).
export const NormalizeEmail = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value
  );
