import { AsyncLocalStorage } from 'async_hooks';

/**
 * Who is really behind the current request.
 *
 * Audit rows used to be written with `userId: user.id`, where `user` comes from
 * `@GetUserFromRequest()` — which, during impersonation, is the *target*. Every
 * audited action an admin took while wearing someone's identity was therefore
 * filed against that person's account. Not a gap in the log: a wrong row
 * (E2E-09-35). The sharpest case was chaining — admin impersonates A, then from
 * that session impersonates B, and the row reads "A impersonated B".
 *
 * The real identity is in the JWT, but the middleware only ever held it in a
 * local, so a handler could not recover it. It is put here instead, once, and
 * every audit write picks it up without the call site having to carry it.
 */
export interface AuditActor {
  /** The authenticated user — the admin, when a session is impersonating. */
  userId?: string;
  /** The user being impersonated, when there is one. */
  impersonatedUserId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<AuditActor>();

export const runWithAuditActor = <T>(actor: AuditActor, fn: () => T): T =>
  storage.run(actor, fn);

export const currentAuditActor = (): AuditActor | undefined =>
  storage.getStore();
