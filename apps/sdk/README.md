# @postra/node

Node.js client for the [Postra](https://postra.co.uk) public API. Node 18 or
newer, no dependencies.

```bash
npm install @postra/node
```

## Usage

Create an API key in Postra under **Settings → Developers** (plans with API
access).

```typescript
import Postra from '@postra/node';

const postra = new Postra(process.env.POSTRA_API_KEY!);

const channels = await postra.integrations();
```

The second argument is the API base URL. It defaults to
`https://app.postra.pl/api`; pass your own only for a self-hosted instance.

| Method | Endpoint | Does |
|---|---|---|
| `integrations()` | `GET /public/v1/integrations` | Connected channels |
| `post(posts)` | `POST /public/v1/posts` | Schedule, publish now or save a draft |
| `postList(filters)` | `GET /public/v1/posts` | Posts between `startDate` and `endDate` |
| `upload(file, extension)` | `POST /public/v1/upload` | Upload an image or MP4 to the media library |
| `mediaList({ page, search })` | `GET /public/v1/media` | The media library, newest first, 18 per page; reuse a `path` instead of uploading again |
| `deletePost(id)` | `DELETE /public/v1/posts/:id` | Delete a post and its thread |

A response other than 2xx throws `PostraError` with `status` and the API's
`body`, so a wrong key reads as `401`, not as a JSON parse error.

## Licence

AGPL-3.0, like the rest of Postra.
