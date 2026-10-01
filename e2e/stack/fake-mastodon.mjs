// A stand-in Mastodon instance for the stack tests. The real Mastodon provider
// publishes here because stack.env points MASTODON_URL at this server, so a
// post goes through the whole path — API, Temporal, orchestrator, provider —
// and lands somewhere a test can read it back. No test code in the app.
//
//   POST /api/v1/statuses   accept a status, like Mastodon does
//   GET  /__received        every status received so far
//   POST /__fail            the next status answers 422 with a Mastodon error
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_MASTODON_PORT || 58080);
const received = [];
let failNext = false;

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

// The provider sends multipart form data; only the text fields matter here.
const formFields = (body, contentType) => {
  const boundary = /boundary=(.+)$/.exec(contentType || '')?.[1];
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
    failNext = true;
    return json(res, 200, { failNext });
  }

  if (req.method === 'POST' && req.url === '/api/v1/statuses') {
    if (failNext) {
      failNext = false;
      return json(res, 422, { error: 'Validation failed: Text character limit of 500 exceeded' });
    }
    const fields = formFields(body, req.headers['content-type']);
    const id = String(100000 + received.length);
    received.push({
      id,
      status: fields.status ?? '',
      inReplyTo: fields.in_reply_to_id ?? null,
      authorization: req.headers.authorization ?? null,
    });
    return json(res, 200, { id, url: `http://localhost:${PORT}/@stack/${id}` });
  }

  json(res, 404, { error: 'Record not found' });
}).listen(PORT, () => console.log(`fake mastodon on ${PORT}`));
