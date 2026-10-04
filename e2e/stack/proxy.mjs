// The same routing production's nginx does (var/docker/nginx.conf): one
// origin, /api/* to the backend with the prefix stripped, everything else to
// the frontend. Without it the browser talks to two origins and hits CORS
// paths production never takes.
// Like production, /uploads/* is served straight from the upload directory
// (nginx `location /uploads/`): media stored locally shows in the composer.
import { createReadStream, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = 54000;
const BACKEND = { port: 53000, strip: '/api' };
const FRONTEND = { port: 54200, strip: '' };
const UPLOADS = process.env.UPLOAD_DIRECTORY || '/tmp/postra-e2e-stack-uploads';
const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

const serveUpload = (req, res) => {
  const relative = normalize(decodeURIComponent(req.url.split('?')[0].slice('/uploads/'.length)));
  const file = join(UPLOADS, relative);
  if (relative.startsWith('..') || !file.startsWith(UPLOADS)) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  if (req.url.startsWith('/uploads/') && (req.method === 'GET' || req.method === 'HEAD')) {
    serveUpload(req, res);
    return;
  }
  const target = req.url.startsWith('/api/') ? BACKEND : FRONTEND;
  const upstream = request(
    {
      host: 'localhost',
      port: target.port,
      method: req.method,
      path: req.url.slice(target.strip.length),
      headers: { ...req.headers, 'x-forwarded-proto': 'http' },
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`stack proxy: ${err.message}`);
  });
  req.pipe(upstream);
}).listen(PORT, () => console.log(`stack proxy on ${PORT}`));
