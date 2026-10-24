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
`https://app.postra.co.uk/api`; pass your own only for a self-hosted instance.

| Method | Endpoint | Does |
|---|---|---|
| `integrations()` | `GET /public/v1/integrations` | Connected channels |
| `post(posts)` | `POST /public/v1/posts` | Schedule, publish now or save a draft |
| `postList(filters)` | `GET /public/v1/posts` | Posts between `startDate` and `endDate` |
| `upload(file, extension)` | `POST /public/v1/upload` | Upload an image or MP4 to the media library |
| `mediaList({ page, search })` | `GET /public/v1/media` | The media library, newest first, 18 per page; reuse a `path` instead of uploading again |
| `deletePost(id)` | `DELETE /public/v1/posts/:id` | Delete a post and its thread |
| `deletePostGroup(group)` | `DELETE /public/v1/posts/group/:group` | Delete every post of a `group` from `postList()` |
| `setPostStatus(id, status, { republish })` | `PUT /public/v1/posts/:id/status` | `draft` takes a post out of the queue, `schedule` puts it back |
| `postMissing(id)` | `GET /public/v1/posts/:id/missing` | Recent items on the platform for a post published without an id |
| `setReleaseId(id, releaseId)` | `PUT /public/v1/posts/:id/release-id` | Link such a post to its item |
| `findSlot(channelId)` | `GET /public/v1/find-slot/:id` | The next free posting time on a channel (UTC) |
| `uploadFromUrl(url)` | `POST /public/v1/upload-from-url` | Postra downloads a file from a public HTTPS address |
| `isConnected()` | `GET /public/v1/is-connected` | `{ connected: true }` when the key works |
| `integrationSettings(channelId)` | `GET /public/v1/integration-settings/:id` | Rules, `maxLength`, settings schema and tools of a channel |
| `triggerIntegration(channelId, methodName, data)` | `POST /public/v1/integration-trigger/:id` | Run one of the channel's tools |
| `connectChannel(platform, { refresh })` | `GET /public/v1/social/:platform` | Sign-in address that connects a new channel |
| `deleteIntegration(channelId)` | `DELETE /public/v1/integrations/:id` | Remove a channel and all its posts |
| `analytics(channelId, { date })` | `GET /public/v1/analytics/:id` | Channel analytics over the last `date` days (default 7) |
| `postAnalytics(postId, { date })` | `GET /public/v1/analytics/post/:postId` | Analytics of one published post |
| `notifications({ page })` | `GET /public/v1/notifications` | Notifications, newest first, 100 per page from page 0 |

Every method returns the API's JSON answer; the shapes are on
[postra.co.uk/docs/api/endpoints](https://postra.co.uk/docs/api/endpoints/).
The AI video routes are not wrapped.

A response other than 2xx throws `PostraError` with `status` and the API's
`body`, so a wrong key reads as `401`, not as a JSON parse error.

## Licence

AGPL-3.0, like the rest of Postra.
