# Playwright smoke tests

Browser tests against a live Postra — production by default. They walk the path
a customer takes first: calendar → composer → draft saved → draft deleted, and
fail on any console error or 5xx from `/api/*`.

⛔ **Drafts only.** "Post now" and "Schedule" publish to real channels. Every
post a test creates starts with `[E2E playwright]`, and `afterAll` deletes any
leftovers of a run that died half-way.

## Run locally

```bash
E2E_EMAIL=… E2E_PASSWORD=… E2E_ORG="Org name" pnpm e2e:smoke
```

| Variable | Required | Meaning |
|---|---|---|
| `E2E_EMAIL`, `E2E_PASSWORD` | yes | test account (LOCAL provider) |
| `E2E_ORG` | when the account is in several organisations | organisation to test in; it needs at least one channel |
| `E2E_CHANNEL` | no, default `bluesky` | provider identifier of the channel to pick in the composer |
| `E2E_BASE_URL` | no, default `https://app.postra.pl` | where to run |

First run on a machine: `pnpm exec playwright install chromium`.

⚠️ Each run signs in once, and sign-in is capped at 5 attempts per 15 minutes
per IP. That is why `retries` is 0.

## In CI

`deploy-dev.yml` runs the suite after the health check, with the account from
the `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_ORG` secrets (skipped with a warning when
they are not set). Traces are off in CI — they record the session cookie, and
this repo's artifacts are public — so a failure uploads screenshots only.

The step is report-only (`continue-on-error`) until it has passed three deploys
in a row. After that, a failure rolls the deploy back like a failed health check.
