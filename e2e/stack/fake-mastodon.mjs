// A stand-in Mastodon instance for the stack tests. The real Mastodon provider
// publishes here because stack.env points MASTODON_URL at this server, so a
// post goes through the whole path — API, Temporal, orchestrator, provider —
// and lands somewhere a test can read it back. No test code in the app.
//
//   POST /api/v1/statuses   accept a status, like Mastodon does
//   GET  /__received        every status received so far
//   POST /__fail {"match": t}  the next status containing t answers 422 with a
//                           Mastodon error. Keyed by text because specs run in
//                           parallel: a bare "fail the next one" was taken by
//                           whichever spec posted first.
//   POST /__hold {"ms": n}  the next status is recorded at once but answered
//                           n ms later — a platform that accepted the post
//                           while the worker that sent it dies (restart/)
//   GET  /api/v1/statuses/:id   a received status with its counts (favourites
//                           3, boosts 2, replies 1) — post statistics; with a
//                           token 403, as for Postra's write-only scopes
//   GET  /xrpc/app.bsky.feed.getPosts?uris=u   Bluesky's public AppView
//                           (stack.env BLUESKY_APPVIEW_URL): any uri, counts
//                           likes 5, reposts 4, replies 3, quotes 2
//   GET  /api/channels/:c/messages/:m   Discord's message (stack.env
//                           DISCORD_API_URL) with reactions 3 + 2; without
//                           a "Bot " authorization 401, like Discord
//   GET  /pexels/v1/search, /pexels/videos/search   Pexels (stack.env
//                           PEXELS_API_URL): one photo / one video for any
//                           query, only with the stack key in Authorization;
//                           GET /__pexels/photo.png and /__pexels/clip.mp4 are
//                           the files they point to; GET /__pexels/seen is
//                           every search received
//   GET  /unsplash/search/photos   Unsplash (stack.env UNSPLASH_API_URL): one
//                           photo for any query, only with "Client-ID <stack
//                           key>"; GET /unsplash/photos/:id/download records a
//                           download (GET /__unsplash/downloads lists them)
//   POST /oauth/token       exchange any code for a token — the account is
//   GET  /api/v1/accounts/verify_credentials   named after the code, so each
//                           connect in a test can be a different account
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_MASTODON_PORT || 58080);
const received = [];
const failMatching = new Set();
let holdNextMs = 0;

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MP4 = 'AAAAGGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVl';
const pexelsSeen = [];
const unsplashDownloads = [];

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

// The provider sends multipart form data; only the text fields matter here.
const formFields = (body, contentType) => {
  const boundary = (contentType || '').split('boundary=')[1];
  if (!boundary) {
    try {
      return JSON.parse(body.toString() || '{}');
    } catch {
      return {};
    }
  }
  const fields = {};
  for (const part of body.toString().split(`--${boundary}`)) {
    const match = /name="([^"]+)"\r\n\r\n([\s\S]*)\r\n$/.exec(part);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
};

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

createServer(async (req, res) => {
  const body = await readBody(req);

  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && req.url === '/__received') return json(res, 200, received);
  if (req.method === 'POST' && req.url === '/__fail') {
    const { match } = JSON.parse(body.toString() || '{}');
    if (!match) return json(res, 400, { error: 'match is required' });
    failMatching.add(String(match));
    return json(res, 200, { failMatching: [...failMatching] });
  }

  if (req.method === 'POST' && req.url === '/__hold') {
    holdNextMs = Number(JSON.parse(body.toString() || '{}').ms) || 0;
    return json(res, 200, { holdNextMs });
  }

  if (req.method === 'GET' && req.url === '/__pexels/photo.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(Buffer.from(PNG_1x1, 'base64'));
  }
  if (req.method === 'GET' && req.url === '/__pexels/clip.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4' });
    return res.end(Buffer.from(MP4, 'base64'));
  }
  if (req.method === 'GET' && req.url === '/__pexels/seen') return json(res, 200, pexelsSeen);
  if (req.method === 'GET' && req.url?.match(/^\/pexels\/(v1|videos)\/search\?/)) {
    const q = new URL(req.url, 'http://fake').searchParams.get('query');
    pexelsSeen.push({ path: req.url.split('?')[0], query: q, auth: req.headers.authorization || '' });
    if (req.headers.authorization !== (process.env.PEXELS_API_KEY || 'stack-fake-pexels')) {
      return json(res, 401, { error: 'Unauthorized' });
    }
    const base = `http://localhost:${PORT}/__pexels`;
    if (req.url.startsWith('/pexels/v1/')) {
      return json(res, 200, {
        page: 1,
        per_page: 24,
        total_results: 1,
        photos: [
          {
            id: 1001,
            url: 'https://www.pexels.com/photo/stack-cake-1001/',
            photographer: 'Stack Photographer',
            photographer_url: 'https://www.pexels.com/@stack',
            alt: `A ${q} on a table`,
            src: { medium: `${base}/photo.png`, large2x: `${base}/photo.png`, original: `${base}/photo.png` },
          },
        ],
      });
    }
    return json(res, 200, {
      page: 1,
      per_page: 20,
      total_results: 1,
      videos: [
        {
          id: 2002,
          url: 'https://www.pexels.com/video/stack-clip-2002/',
          image: `${base}/photo.png`,
          duration: 8,
          user: { name: 'Stack Filmmaker', url: 'https://www.pexels.com/@stack-film' },
          video_files: [
            { id: 1, quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: `${base}/clip.mp4` },
            { id: 2, quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: `${base}/clip.mp4` },
            { id: 3, quality: 'uhd', file_type: 'video/mp4', width: 3840, height: 2160, link: `${base}/clip.mp4` },
          ],
        },
      ],
    });
  }
  if (req.method === 'GET' && req.url === '/__unsplash/downloads') return json(res, 200, unsplashDownloads);
  const unsplashAuthorized = () =>
    req.headers.authorization === `Client-ID ${process.env.UNSPLASH_ACCESS_KEY || 'stack-fake-unsplash'}`;
  if (req.method === 'GET' && req.url?.startsWith('/unsplash/search/photos?')) {
    if (!unsplashAuthorized()) return json(res, 401, { errors: ['OAuth error: The access token is invalid'] });
    const q = new URL(req.url, 'http://fake').searchParams.get('query');
    const base = `http://localhost:${PORT}`;
    return json(res, 200, {
      total: 1,
      total_pages: 1,
      results: [
        {
          id: 'StackUnspl1',
          alt_description: `${q} on a wooden table`,
          urls: { small: `${base}/__pexels/photo.png`, regular: `${base}/__pexels/photo.png`, full: `${base}/__pexels/photo.png` },
          links: {
            html: 'https://unsplash.com/photos/StackUnspl1',
            download_location: `${base}/unsplash/photos/StackUnspl1/download?ixid=stack`,
          },
          user: { name: 'Stack Lens', links: { html: 'https://unsplash.com/@stacklens' } },
        },
      ],
    });
  }
  const unsplashDownload = req.method === 'GET' && req.url?.match(/^\/unsplash\/photos\/([^/?]+)\/download/);
  if (unsplashDownload) {
    if (!unsplashAuthorized()) return json(res, 401, { errors: ['OAuth error'] });
    unsplashDownloads.push(unsplashDownload[1]);
    return json(res, 200, { url: `http://localhost:${PORT}/__pexels/photo.png` });
  }
  if (req.method === 'POST' && req.url === '/oauth/token') {
    const { code } = formFields(body, req.headers['content-type']);
    return json(res, 200, { access_token: `fake-${code || 'none'}`, token_type: 'Bearer' });
  }
  if (req.method === 'GET' && req.url === '/api/v1/accounts/verify_credentials') {
    const code = String(req.headers.authorization || '').replace(/^Bearer fake-/, '');
    return json(res, 200, {
      id: `acct-${code}`,
      username: code,
      acct: code,
      display_name: `Invited ${code}`,
      avatar: '',
    });
  }

  if (req.method === 'POST' && req.url === '/api/v1/statuses') {
    const fields = formFields(body, req.headers['content-type']);
    const failing = [...failMatching].find((m) => (fields.status ?? '').includes(m));
    if (failing) {
      failMatching.delete(failing);
      return json(res, 422, { error: 'Validation failed: Text character limit of 500 exceeded' });
    }
    const id = String(100000 + received.length);
    received.push({
      id,
      status: fields.status ?? '',
      inReplyTo: fields.in_reply_to_id ?? null,
      authorization: req.headers.authorization ?? null,
    });
    const hold = holdNextMs;
    holdNextMs = 0;
    if (hold) await new Promise((r) => setTimeout(r, hold));
    return json(res, 200, { id, url: `http://localhost:${PORT}/@stack/${id}` });
  }

  const status = req.method === 'GET' && req.url?.match(/^\/api\/v1\/statuses\/(\d+)$/);
  if (status) {
    // Like Mastodon: a token without read:statuses (Postra asks only for
    // write scopes) is refused; a public status reads without one.
    if (req.headers.authorization) {
      return json(res, 403, { error: 'This action is outside the authorized scopes' });
    }
    const found = received.find((r) => r.id === status[1]);
    if (!found) return json(res, 404, { error: 'Record not found' });
    return json(res, 200, { id: found.id, favourites_count: 3, reblogs_count: 2, replies_count: 1 });
  }

  const message = req.method === 'GET' && req.url?.match(/^\/api\/channels\/([^/]+)\/messages\/([^/?]+)$/);
  if (message) {
    if (!String(req.headers.authorization || '').startsWith('Bot ')) {
      return json(res, 401, { message: '401: Unauthorized', code: 0 });
    }
    return json(res, 200, {
      id: message[2],
      channel_id: message[1],
      reactions: [
        { count: 3, emoji: { name: '👍' } },
        { count: 2, emoji: { name: '🎉' } },
      ],
    });
  }

  if (req.method === 'GET' && req.url?.startsWith('/xrpc/app.bsky.feed.getPosts?')) {
    const uri = new URL(req.url, 'http://fake').searchParams.get('uris');
    return json(res, 200, {
      posts: uri ? [{ uri, likeCount: 5, repostCount: 4, replyCount: 3, quoteCount: 2 }] : [],
    });
  }

  json(res, 404, { error: 'Record not found' });
}).listen(PORT, () => console.log(`fake mastodon on ${PORT}`));
