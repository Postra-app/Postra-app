# Stack tests

The whole app on throwaway stores, driven by Playwright — over HTTP (`api/`)
and in Chromium (`ui/`). Runs on every pull request (`ci.yml` job `stack-e2e`).

```
pnpm build             # backend, orchestrator and frontend run from their builds
pnpm e2e:stack         # API layer: stores up → migrations → reset + seed → api/
pnpm e2e:stack:ui      # the same plus the frontend and Chromium: api/ + ui/
pnpm e2e:stack:down    # stop the stores
```

For the API layer alone, `pnpm build:backend && pnpm build:orchestrator` is
enough.

What runs:

| Piece | Port | Notes |
|---|---|---|
| Postgres 17, Redis 7, Temporal dev server | 55432, 56379, 57233 | `docker-compose.yml`; offset ports, Postgres in tmpfs |
| backend | 53000 | `apps/backend/dist`, migrated by `scripts/db-migrate.mjs` like production |
| orchestrator (Temporal worker) | — (metrics 9464) | without it nothing publishes |
| fake Mastodon | 58080 | `fake-mastodon.mjs`; `MASTODON_URL` points the real provider here |
| frontend | 54200 | `next start`, UI layer only |
| proxy | 54000 | `proxy.mjs`: one origin, `/api/*` → backend, the rest → frontend — what production's nginx does |

`global-setup.ts` empties every table and Redis (the login throttle lives
there and outlives a backend restart), seeds three organisations
(`seed.ts`: A on Pro with a member, B on Starter, C on Business with all five
seats taken) and signs each user in once through `POST /auth/login`. Specs
that push an organisation to a limit make their own with `throwawayOrg`
(`helpers.ts`) instead of filling the shared ones. Server output goes to
`.logs/<app>.log`; CI uploads it with the screenshots when a run fails.

`stack.env` holds only local fakes and is safe to commit. The seed refuses to
wipe anything but the stores from `docker-compose.yml`.

Publishing: `api/publish.spec.ts` and the "Post Now" UI test publish through
API → Temporal → orchestrator → the real Mastodon provider → the fake, which
records every status (`GET /__received`) and can refuse the next one
(`POST /__fail`, a Mastodon-shaped 422).

Writing tests:

- Assert the status code first, then the body. A 500 is always a bug.
- Anything one organisation owns gets a case in `tenant-isolation.spec.ts`:
  the other organisation must get 404 (not 403 — it must not learn the
  resource exists) and must change nothing.
- Name a test after the e2e/bugs.md entry it guards (`E2E-05-12: …`).
- UI selectors by role and text, never by Tailwind classes.
- Locally a server already listening on its port is reused; after a code
  change stop it (`lsof -ti tcp:53000 | xargs kill`, same for 9464, 58080,
  54200, 54000) and rebuild, or you test the old code.
