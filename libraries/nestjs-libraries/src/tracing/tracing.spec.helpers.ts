import { fork, type ChildProcess } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage } from 'http';
import { createServer as createTcpServer, type AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import ts from 'typescript';

const root = join(__dirname, '..', '..', '..', '..');

// Values that must reach the other side of a request and never a span.
export const SECRETS = {
  queryToken: 'query-token-value',
  email: 'jane.doe@example.com',
  bearer: 'incoming-bearer-value',
  cookie: 'cookie-session-value',
  body: 'the text of a post nobody else should read',
  outgoingBearer: 'outgoing-bearer-value',
  outgoingToken: 'platform-access-token-value',
  outgoingBody: 'the text sent to the platform',
  serverCookie: 'server-cookie-value',
  pathKey: 'bot123456789:AAF-secret_bot_token_0123456789',
  redisPassword: 'redis-password-value',
  redisValue: 'redis-stored-value',
  databasePassword: 'database-password-value',
  sqlValue: 'sql-parameter-value',
  clientIp: '203.0.113.77',
  baggage: 'baggage-value-from-the-caller',
};

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

/** A local HTTP server that answers every request and keeps what it received. */
export const listen = async (answer: unknown = {}) => {
  const received: ReceivedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.setHeader('content-type', 'application/json');
      res.setHeader('set-cookie', `session=${SECRETS.serverCookie}`);
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    address: `127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/**
 * Enough of a Redis server for one client: answers OK to every command and
 * keeps the commands it received.
 */
export const listenRedis = async () => {
  const commands: string[][] = [];
  const server = createTcpServer((socket) => {
    let buffer = '';
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      // A command is an array of bulk strings: *2 $3 GET $3 key, each on a line.
      for (;;) {
        const lines = buffer.split('\r\n');
        const count = /^\*(\d+)$/.exec(lines[0] ?? '');
        if (!count || lines.length < 2 + Number(count[1]) * 2) {
          return;
        }
        const parts = lines.slice(1, 1 + Number(count[1]) * 2);
        commands.push(parts.filter((_, index) => index % 2 === 1));
        buffer = lines.slice(1 + parts.length).join('\r\n');
        socket.write('+OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    address: `127.0.0.1:${port}`,
    commands,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/** An address on this machine with nothing listening on it. */
export const closedAddress = async () => {
  const server = await listen();
  await server.close();
  return server.address;
};

export interface FixtureSpan {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  scope: string;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  events: { name: string; attributes?: Record<string, unknown> }[];
  resource: Record<string, unknown>;
}

interface Ready {
  port: number;
  started: boolean;
  sdkLoaded: boolean;
  recording: boolean;
}

// The fixture and the modules under test, compiled the way the apps are
// (CommonJS) into a folder outside the repository.
const SOURCES = ['initialize.tracing', 'start.tracing', 'scrub.span', 'tracing.fixture'];
const compile = () => {
  const out = mkdtempSync(join(tmpdir(), 'tracing-spec-'));
  for (const name of SOURCES) {
    const { outputText } = ts.transpileModule(
      readFileSync(join(__dirname, `${name}.ts`), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      }
    );
    writeFileSync(join(out, `${name}.js`), outputText);
  }
  return out;
};

export interface FixtureConfig {
  /** Keep the spans in the fixture's memory, to be read with `spans()`. */
  exporter?: 'memory';
  platformUrl?: string;
  redisAddress?: string;
  closedAddress?: string;
}

/** Starts the fixture server in its own Node process with the given environment. */
export const startFixture = async (
  env: Record<string, string | undefined>,
  config: FixtureConfig = {}
) => {
  const out = compile();
  const argument = JSON.stringify({ ...config, secrets: SECRETS });
  const child: ChildProcess = fork(join(out, 'tracing.fixture.js'), [argument], {
    cwd: root,
    env: {
      ...process.env,
      // Jest's own loader flags are not for the child.
      NODE_OPTIONS: '',
      NODE_ENV: 'test',
      NODE_PATH: join(root, 'node_modules'),
      OTEL_TRACES_ENDPOINT: undefined,
      OTEL_TRACES_SAMPLE_RATIO: undefined,
      NEXT_PUBLIC_VERSION: undefined,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) =>
    child.on('exit', (code) => resolve(code))
  );

  const next = <T>(type: string) =>
    new Promise<T>((resolve, reject) => {
      const onMessage = (message: { type: string }) => {
        if (message.type === type) {
          child.off('message', onMessage);
          resolve(message as unknown as T);
        }
      };
      child.on('message', onMessage);
      void exited.then((code) =>
        reject(new Error(`fixture exited with ${code} before "${type}":\n${output}`))
      );
    });

  const ready = await next<Ready>('ready');
  return {
    ...ready,
    url: `http://127.0.0.1:${ready.port}`,
    output: () => output,
    /** The spans finished since the last call. */
    spans: async () => {
      child.send({ type: 'spans' });
      return (await next<{ spans: FixtureSpan[] }>('spans')).spans;
    },
    /** Shuts tracing down and ends the process; resolves to the time the shutdown took. */
    shutdown: async (timeoutMs?: number) => {
      child.send({ type: 'shutdown', timeoutMs });
      const { ms } = await next<{ ms: number }>('shutdown');
      const code = await exited;
      rmSync(out, { recursive: true, force: true });
      return { ms, code };
    },
    kill: async () => {
      child.kill('SIGKILL');
      await exited;
      rmSync(out, { recursive: true, force: true });
    },
  };
};

export type Fixture = Awaited<ReturnType<typeof startFixture>>;
