# Postra Public API

A REST API for one Postra organisation: list its channels, upload media,
create, schedule and delete posts, and read analytics.

- **Base URL:** `https://app.postra.pl/api/public/v1`
- **Format:** JSON in and out; file uploads are `multipart/form-data`.
- **Node.js client:** [`@postra/node`](#nodejs-sdk)
- **Building a product for other Postra users?** Use [OAuth](oauth.md) instead
  of asking for their API key.

Use this base URL as it is. Without `/api` the request reaches the web app
and is redirected to the login page; `app.postra.co.uk` redirects to
`app.postra.pl`, and a redirect does not carry a `POST` body.

## Authentication

Send one header with every request:

```
Authorization: <credential>
```

The value is the credential itself, **without** a `Bearer` prefix. Two kinds
are accepted:

| Credential | Where it comes from | Acts for |
|---|---|---|
| Organisation API key | **Settings → Developers → Access** in Postra | your own organisation |
| OAuth access token, starts with `pos_` | the [OAuth flow](oauth.md) | the organisation that approved your app |

Either credential has the rights of an organisation admin. The Developers tab
is shown to owners and admins on paid plans. **Rotate Key** on the same page
issues a new key; the old one stops working at once. Keep keys on a server,
never in a browser or a mobile app.

```bash
curl https://app.postra.pl/api/public/v1/integrations \
  -H "Authorization: $POSTRA_API_KEY"
```

## Endpoints

All paths are relative to the base URL. `:id` of a channel is the `id` from
`GET /integrations`; `:id` of a post is a `postId` from `POST /posts` or an
`id` from `GET /posts`.

### Channels

| Method and path | What it does |
|---|---|
| `GET /is-connected` | Checks the credential. Returns `{"connected": true}`. |
| `GET /integrations` | Connected channels: `id`, `name`, `identifier` (platform), `picture`, `disabled`, `profile`, `customer`. |
| `GET /integration-settings/:id` | What a channel accepts: `rules`, `maxLength`, the `settings` schema for posts and the `tools` it offers. |
| `GET /find-slot/:id` | Next free time slot on the channel: `{"date": "…"}`. |
| `GET /social/:platform` | Starts connecting a new channel; `:platform` is an `identifier` such as those in `GET /integrations`. Returns `{"url": "…"}` to open in a browser where a member of the organisation is signed in to Postra. A platform outside the plan answers `402`. |
| `POST /integration-trigger/:id` | Runs one of the channel's `tools` (for example, listing the boards or pages to post to). Body: `{"methodName": "…", "data": {…}}`. |
| `DELETE /integrations/:id` | Removes the channel **and deletes its posts**. |

### Posts

| Method and path | What it does |
|---|---|
| `GET /posts?startDate=…&endDate=…` | Posts in the range (ISO 8601 dates, at most 370 days; `customer` optional). Returns `{"posts": […]}`. |
| `POST /posts` | Creates a draft, a scheduled post or one published now. See below. |
| `DELETE /posts/:id` | Deletes the post and its thread (its follow-up parts). |
| `DELETE /posts/group/:group` | The same, by the `group` value of a post from `GET /posts`. |
| `PUT /posts/:id/status` | `{"status": "draft"}` or `{"status": "schedule"}`. Putting a published post back in the queue needs `"republish": true`. |
| `GET /posts/:id/missing` | For a post the platform published without returning its id: the platform's recent items to choose from. |
| `PUT /posts/:id/release-id` | `{"releaseId": "…"}` links such a post to the platform's item. |

#### Creating a post

```bash
curl https://app.postra.pl/api/public/v1/posts \
  -H "Authorization: $POSTRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "schedule",
    "date": "2026-11-02T09:30:00.000Z",
    "shortLink": false,
    "tags": [],
    "posts": [
      {
        "integration": { "id": "<channel id>" },
        "value": [
          { "content": "Hello from the Postra API", "image": [] }
        ]
      }
    ]
  }'
```

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `draft`, `schedule` or `now` |
| `date` | yes | Publish time, ISO 8601 (also sent with `now`) |
| `shortLink` | yes | `true` shortens links in the content |
| `tags` | yes | `[{"value": "…", "label": "…"}]`, may be empty |
| `posts` | yes | One entry per channel (1–50) |
| `posts[].integration.id` | yes | Channel id |
| `posts[].value` | yes | 1–100 items: the first is the post, the rest are follow-up parts (thread replies or comments, depending on the platform) |
| `posts[].value[].content` | yes | Text; a small set of HTML tags (`<p>`, `<br>`, `<strong>` …) is kept, the rest is removed |
| `posts[].value[].image` | yes | Up to 20 media items `{"id": "…", "path": "…"}` from an upload; may be empty |
| `posts[].settings` | per platform | Platform options; `GET /integration-settings/:id` describes them |
| `inter` | no | Repeat the post every N days (N ≥ 1) |

The answer is `201` with `[{"postId": "…", "integration": "…"}]`, one item per
channel. Posts are checked with the same rules as the Postra editor (length,
media, required settings); a failure is a `400` naming the channel:
`{"statusCode": 400, "provider": "x", "name": "X", "message": "…"}`. A draft
is only checked for having some text or media.

### Media

Media in a post must be uploaded to Postra first, or picked from the media library.

| Method and path | What it does |
|---|---|
| `POST /upload` | `multipart/form-data` with the file in the `file` field. |
| `POST /upload-from-url` | `{"url": "https://…"}`. Postra downloads the file; the address must be public HTTPS and its path must end in `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` or `.mp4`. |
| `GET /media?page=1&search=…` | The media library, newest first, 18 per page: `{"pages": n, "results": [{"id", "name", "originalName", "path", "createdAt"}]}`. `search` matches the original file name; `page` is 1–100000. Reuse an `id` and `path` in `image` instead of uploading the file again. |

Accepted types are JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF and MP4, recognised
by content, not by name. `/upload` takes images up to 10 MB and requests up to
50 MB in total; `/upload-from-url` takes files up to 100 MB. Both answer with
the media item; use its `id` and `path` in `image`.

```bash
curl https://app.postra.pl/api/public/v1/upload \
  -H "Authorization: $POSTRA_API_KEY" \
  -F "file=@photo.jpg"
```

### Analytics and notifications

| Method and path | What it does |
|---|---|
| `GET /analytics/:id?date=7` | Channel analytics for the last `date` days (default 7). |
| `GET /analytics/post/:postId?date=7` | Analytics of one published post. |
| `GET /notifications?page=0` | The organisation's notifications, paginated from `0`. |

## Limits

Limits are counted per organisation.

| Endpoint | Limit |
|---|---|
| `POST /posts` | 90 requests per hour, plus the monthly post allowance of the plan |
| `POST /upload`, `POST /upload-from-url` | 30 per 5 minutes |
| `GET /social/:platform`, `GET /analytics/…` | 60 per 5 minutes |
| `GET /posts/:id/missing`, `POST /integration-trigger/:id` | 30 per 5 minutes |

Over a rate limit the answer is `429`; wait and retry. The monthly post
allowance answers `402` instead (see below).

## Errors

| Status | Body | Meaning |
|---|---|---|
| `400` | `{"message": [ … ], "error": "Bad Request"}` | A field is missing or invalid |
| `400` | `{"provider": …, "name": …, "message": …}` | A post fails the platform's rules |
| `401` | `{"msg": "No API Key found"}` | No `Authorization` header |
| `401` | `{"msg": "Invalid API key"}` | Unknown key (also sent for `Bearer <key>`) |
| `401` | `{"msg": "Invalid OAuth token"}` | Unknown, revoked or no longer valid `pos_` token |
| `401` | `{"msg": "No subscription found"}` | The organisation has no active subscription |
| `402` | `{"statusCode": 402, "message": "…"}` | The plan does not allow it (monthly posts, a platform outside the plan) |
| `404` | | The channel or post does not exist in this organisation |
| `429` | | Rate limit, see [Limits](#limits) |

## Node.js SDK

[`@postra/node`](https://www.npmjs.com/package/@postra/node) wraps
`integrations`, `posts` (create, list, delete), `upload` and `mediaList`. It sends the
credential in the same header, so an OAuth `pos_` token works too.

```bash
npm install @postra/node
```

```typescript
import Postra from '@postra/node';

const postra = new Postra(process.env.POSTRA_API_KEY!);
const channels = await postra.integrations();
```

See the [SDK README](../../apps/sdk/README.md) for every method.

## MCP

The same credentials work with Postra's MCP server at
`https://app.postra.pl/api/mcp`. MCP clients send them as
`Authorization: Bearer <credential>`. **Settings → Developers → Access**
generates the configuration for common clients.
