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
//   POST /oauth/token       exchange any code for a token — the account is
//   GET  /api/v1/accounts/verify_credentials   named after the code, so each
//                           connect in a test can be a different account
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_MASTODON_PORT || 58080);
const received = [];
const failMatching = new Set();
let holdNextMs = 0;

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

  json(res, 404, { error: 'Record not found' });
}).listen(PORT, () => console.log(`fake mastodon on ${PORT}`));
