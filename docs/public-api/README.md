# Postra Public API

The reference lives in the public docs at **https://postra.co.uk/docs/**. This
folder used to hold a copy, and the copy fell behind the code (E2E-08-59), so
it now only points there.

| Topic | Page |
|---|---|
| Base URL, API key, first request | https://postra.co.uk/docs/api/ |
| Every route, its fields, errors and limits | https://postra.co.uk/docs/api/endpoints/ |
| Uploading media and reusing the library | https://postra.co.uk/docs/api/uploads/ |
| What each platform accepts, and its settings | https://postra.co.uk/docs/api/platforms/ |
| MCP for AI assistants (ChatGPT, Claude, Cursor …) | https://postra.co.uk/docs/mcp/ |
| Webhooks and checking their signature | https://postra.co.uk/docs/webhooks/ |
| Node.js SDK `@postra/node` | https://postra.co.uk/docs/sdk/ |
| Sign in with Postra (OAuth) for apps used by other Postra customers | https://postra.co.uk/docs/oauth/ |

The docs are written from this repository's code; a change to a public route,
its fields or its limits needs the matching docs page changed too (the pages
are in the Postra-infra repository, `landing/src/pages/docs/`).
