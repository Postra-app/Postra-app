// The same routing production's nginx does (var/docker/nginx.conf): one
// origin, /api/* to the backend with the prefix stripped, everything else to
// the frontend. Without it the browser talks to two origins and hits CORS
// paths production never takes.
import { createServer, request } from 'node:http';

const PORT = 54000;
const BACKEND = { port: 53000, strip: '/api' };
const FRONTEND = { port: 54200, strip: '' };

createServer((req, res) => {
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
