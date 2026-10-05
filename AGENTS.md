# AGENTS.md

Project context (what Postra is, the monorepo layout, pnpm only): see `CLAUDE.md`.

## Code Review Rules

Report real defects only: `file:line`, a concrete failure (input → wrong result) and how sure you are. No style notes. Say what you did not verify.

### Weigh severity by reachable input
- Requests are validated by class-validator DTOs before they reach a service (`libraries/nestjs-libraries/src/dtos`). Check what a DTO allows before rating a finding; a path no current client or DTO can reach is a minor issue, not a P1.
- The agent (`chat/tools`), Auto Post and the public API also write posts — check them as well.

### Data
- Any change to `schema.prisma` ships with a Prisma migration. Never `db push`.
- Checks that guard a write (versions, limits, ownership) must run inside the same transaction as the write, or a concurrent request slips past them.

### API correctness
- Bad input returns 400/404, never 500 (validate params, guard optional values).
- Errors from third-party SDKs must not leak their `statusCode`/`message` through Nest — a provider's 401 must not log our user out.
- Anything one organisation owns is scoped by `organizationId`; another organisation gets 404 and changes nothing.

### Auth
- Never weaken the session check on `POST /integrations/social-connect`. The only exception is the invite link flow.

### AI
- Server-side calls to AI providers use `import { fetch } from 'undici'`.

### Frontend
- Do not set `Content-Type` explicitly with `useFetch` / `customFetch`.
- User-facing text is English.

### Product
- Changing a provider's capabilities updates `help.data.ts` in the same change.
- "Postiz" appears only in NOTICE / LICENSE / README. Do not rename the `@gitroom` import alias.

### Tests
- A fix comes with a test that fails on the old code (jest next to the code, or `e2e/stack` for behaviour across the API, the database and Temporal).

### Security
- No secrets, tokens or customer personal data in code, tests or fixtures.
