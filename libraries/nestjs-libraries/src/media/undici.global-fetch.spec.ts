import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// undici 8.11.0 replaced the dispatcher Node's built-in fetch reads
// (Symbol.for('undici.globalDispatcher.1')) as soon as the package was
// required, and on Node 22 every global fetch after that came back
// without response headers: no content-type, no content-encoding, gzip bodies
// left compressed. In production that broke Pixabay search ("is not valid
// JSON") and every OpenAI SDK call ("reading 'map'"), and it sat under 25 of
// the 26 social providers. Only HTTP/2 answers lost them, and Cloudflare,
// OpenAI and most APIs offer HTTP/2, so the server here has to as well. The
// backend imports undici at startup and jest gives each suite its own
// globalThis, so this runs a real Node process.
const script = `
const http2 = require('http2');
const zlib = require('zlib');
const fs = require('fs');
require('undici');
const dir = process.env.CERT_DIR;
const server = http2.createSecureServer(
  {
    key: fs.readFileSync(dir + '/key.pem'),
    cert: fs.readFileSync(dir + '/cert.pem'),
    allowHTTP1: true,
  },
  (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync(JSON.stringify({ ok: true })));
  }
);
server.listen(0, async () => {
  try {
    const res = await fetch('https://localhost:' + server.address().port + '/');
    const body = await res.text();
    console.log(JSON.stringify({ type: res.headers.get('content-type'), body }));
  } finally {
    server.close();
  }
});
`;

describe('global fetch after undici is loaded', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'undici-fetch-'));
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'ignore' });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps response headers and decodes gzip from an HTTP/2 server', () => {
    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        CERT_DIR: dir,
        NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem'),
      },
    });
    expect(JSON.parse(out.trim())).toEqual({
      type: 'application/json',
      body: '{"ok":true}',
    });
  });
});
