
# Copilot Coding Agent Instructions for Postra

## Project Architecture
- pnpm workspace monorepo, with apps in `apps/` and shared code in `libraries/`.
- Apps: `frontend` (Next.js), `backend` (NestJS API), `orchestrator` (NestJS Temporal worker: workflows and activities), `commands` (maintenance CLI), `extension` (browser extension) and `sdk` (`@postra/node`).
- Data layer uses Prisma ORM (`libraries/nestjs-libraries/src/database/prisma/schema.prisma`) with PostgreSQL.
- Scheduled posts and background jobs run on Temporal. Redis is used for caching, rate limiting and short-lived state.
- Email via Resend or any SMTP server (`EMAIL_PROVIDER`; production uses Amazon SES SMTP).
- Social channels are the providers in `libraries/nestjs-libraries/src/integrations/social`; the ones offered to customers are `enabledProviders` in `integration.manager.ts`.

## Developer Workflows
- Use Node.js 22: the exact version is `volta.node` in `package.json` (CI and `Dockerfile.dev` follow it); pnpm from `packageManager`.
- Install dependencies: `pnpm install`
- Build frontend, backend and orchestrator: `pnpm run build`
- Run in dev mode: `pnpm run dev`
- Test: `pnpm test` (Jest, coverage enabled); stack tests: `pnpm e2e:stack` (see `e2e/stack/README.md`)
- Individual app scripts are in each app's `package.json` (e.g., `pnpm --filter ./apps/backend run dev`).
- Prisma DB commands: `pnpm run prisma-generate`, `pnpm run prisma-db-migrate` (apply migrations), `pnpm run prisma-migrate-dev` (create one). Never `prisma db push`.
- Local infrastructure: `make infra` (Postgres, Redis, Temporal); `make dev` also runs migrations and starts backend + frontend. See `Makefile`.

## Conventions & Patterns
- Use conventional commits (`feat:`, `fix:`, `chore:`).
- PRs should include clear descriptions, related issue links, and UI screenshots/GIFs if relevant.
- Comments are required for complex logic.
- Shared code lives in `libraries/` (e.g., helpers, React shared libraries, NestJS modules).
- Environment variables are managed via `.env` and referenced in Docker and scripts.
- Make sure to keep the `.env.example` file updated with new environment variables.

## Integration Points
- External APIs: social platforms, OpenAI, Stripe, email (Resend or SMTP), AWS S3, Sentry.
- SDK (`apps/sdk`, published as `@postra/node`) is a client for the public API (`apps/backend/src/public-api`). Releases go out on a `sdk-v*` tag (`.github/workflows/publish-sdk.yml`).
- Extension (`apps/extension`) is a Chrome MV3 service worker built with Vite and TypeScript; it reads cookies for cookie-based providers (Skool).

## Key Files & Directories
- `apps/` — Main services and applications
- `libraries/` — Shared code and modules
- `docker-compose.dev.yaml` and `Makefile` — Local development Docker setup
- `.env` — Environment configuration
- `jest.config.ts` — Test configuration
- `pnpm-workspace.yaml` — Workspace package management
- `README.md` — General project overview
- `libraries/nestjs-libraries/src/database/prisma/schema.prisma` — Database schema

## Documentation
- There is no hosted docs site. `README.md`, `CLAUDE.md` and `AGENTS.md` at the repo root are the reference.

---

# Logs

- Where logs are used, ensure Sentry is imported using `import * as Sentry from "@sentry/nextjs"`
- Enable logging in Sentry using `Sentry.init({ enableLogs: true })`
- Reference the logger using `const { logger } = Sentry`
- Sentry offers a `consoleLoggingIntegration` that can be used to log specific console error types automatically without instrumenting the individual logger calls

## Configuration

The Sentry initialization needs to be updated to enable the logs feature.

### Baseline

```javascript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  enableLogs: true,
});
```

### Logger Integration

```javascript
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  integrations: [
    // send console.log, console.error, and console.warn calls as logs to Sentry
    Sentry.consoleLoggingIntegration({ levels: ["log", "error", "warn"] }),
  ],
});
```

## Logger Examples

`logger.fmt` is a template literal function that should be used to bring variables into the structured logs.

```javascript
import * as Sentry from "@sentry/nextjs";

const { logger } = Sentry;

logger.trace("Starting database connection", { database: "users" });
logger.debug(logger.fmt`Cache miss for user: ${userId}`);
logger.info("Updated profile", { profileId: 345 });
logger.warn("Rate limit reached for endpoint", {
  endpoint: "/api/results/",
  isEnterprise: false,
});
logger.error("Failed to process payment", {
  orderId: "order_123",
  amount: 99.99,
});
logger.fatal("Database connection pool exhausted", {
  database: "users",
  activeConnections: 100,
});
```

---

For questions or unclear conventions, check the main README or ask for clarification in your PR description.

