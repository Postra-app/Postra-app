import { createServer, Server, Socket } from 'net';
import { AddressInfo } from 'net';
import { Redis } from 'ioredis';
import {
  connectRedis,
  redisOptions,
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_SOCKET_TIMEOUT_MS,
} from '@gitroom/nestjs-libraries/redis/redis.service';

// A Redis that answers every command (INFO for the client's ready check, OK
// for the rest) until told to go silent: connections stay open and nothing
// comes back, which is what a dead host looks like from the client.
const fakeRedis = async () => {
  // `silent` drops the answers; `late` holds them back until speak().
  const state = {
    silent: false,
    late: false,
    connections: 0,
    commands: [] as string[],
  };
  const held: (() => void)[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    state.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      if (state.silent) return;
      const lines = chunk.toString().split('\r\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].startsWith('*')) continue;
        const name = (lines[i + 2] || '').toLowerCase();
        state.commands.push(name);
        const answer = () =>
          socket.write(
            name === 'info'
              ? '$32\r\nredis_version:7.0.0\r\nloading:0\r\n\r\n'
              : '+OK\r\n'
          );
        if (state.late) held.push(answer);
        else answer();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    speak: () => {
      state.late = false;
      held.splice(0).forEach((answer) => answer());
    },
    port: (server.address() as AddressInfo).port,
    close: async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

const settled = async (promise: Promise<unknown>, withinMs: number) => {
  const started = Date.now();
  const outcome = await Promise.race([
    promise.then(
      () => 'resolved',
      (err: Error) => `rejected: ${err.message}`
    ),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('pending'), withinMs)
    ),
  ]);
  return { outcome, ms: Date.now() - started };
};

const connectTo = (port: number) => {
  const client = new Redis(`redis://127.0.0.1:${port}`, {
    ...redisOptions,
    commandTimeout: 200,
    socketTimeout: 500,
    retryStrategy: () => 50,
  });
  client.on('error', () => undefined);
  return client;
};

describe('Redis client during an outage', () => {
  it('limits every command and every silent connection in the shared options', () => {
    expect(redisOptions.commandTimeout).toBe(REDIS_COMMAND_TIMEOUT_MS);
    expect(redisOptions.socketTimeout).toBe(REDIS_SOCKET_TIMEOUT_MS);
    expect(REDIS_COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(3000);
    // A command gives up before its connection does, so one slow command
    // does not cost the others their connection.
    expect(REDIS_SOCKET_TIMEOUT_MS).toBeGreaterThan(REDIS_COMMAND_TIMEOUT_MS);
  });

  it('refuses a command at once when nothing listens, instead of leaving it pending', async () => {
    // A port that was open a moment ago and is closed now.
    const gone = await fakeRedis();
    await gone.close();
    const client = connectTo(gone.port);
    try {
      const { outcome, ms } = await settled(client.get('key'), 1500);
      expect(outcome).toMatch(/^rejected: /);
      expect(ms).toBeLessThan(150);
    } finally {
      client.disconnect();
    }
  });

  it('never sends, once Redis is back, a command it refused while Redis was away', async () => {
    const server = await fakeRedis();
    const client = connectTo(server.port);
    try {
      await new Promise((resolve) => client.once('ready', resolve));
      expect(await client.set('key', '1')).toBe('OK');
      // The connection drops and stays down for a moment.
      server.state.silent = true;
      await settled(client.get('key'), 1500);
      await new Promise((resolve) => client.once('close', resolve));

      const { outcome } = await settled(client.incr('failed-sign-ins'), 1500);
      expect(outcome).toMatch(/^rejected: /);

      server.state.silent = false;
      await new Promise((resolve) => client.once('ready', resolve));
      expect(await client.set('key', '2')).toBe('OK');
      expect(server.state.commands).not.toContain('incr');
    } finally {
      client.disconnect();
      await server.close();
    }
  });

  it('the app client takes a command sent before its first connection is up', async () => {
    const server = await fakeRedis();
    const client = connectRedis(`redis://127.0.0.1:${server.port}`);
    client.on('error', () => undefined);
    try {
      // No waiting for "ready": what a script or a spec does right after import.
      expect(await client.set('key', '1')).toBe('OK');
      expect(client.options.enableOfflineQueue).toBe(false);
    } finally {
      client.disconnect();
      await server.close();
    }
  });

  it('reconnects when the peer stops answering on an open connection', async () => {
    const server = await fakeRedis();
    const client = connectTo(server.port);
    try {
      await new Promise((resolve) => client.once('ready', resolve));
      expect(await client.set('key', '1')).toBe('OK');
      expect(server.state.connections).toBe(1);

      server.state.silent = true;
      expect((await settled(client.get('key'), 1500)).outcome).toBe(
        'rejected: Command timed out'
      );
      // The connection owed an answer and stayed silent: dropped, so the
      // client is no longer "ready" and callers can skip Redis at once.
      await new Promise((resolve) => client.once('close', resolve));
      expect(client.status).not.toBe('ready');

      server.state.silent = false;
      await new Promise((resolve) => client.once('ready', resolve));
      expect(server.state.connections).toBeGreaterThanOrEqual(2);
      expect(await client.set('key', '2')).toBe('OK');
    } finally {
      client.disconnect();
      await server.close();
    }
  });

  it('keeps the connection when an answer is late but arrives', async () => {
    const server = await fakeRedis();
    const client = connectTo(server.port);
    try {
      await new Promise((resolve) => client.once('ready', resolve));
      for (let i = 0; i < 3; i += 1) {
        server.state.late = true;
        expect((await settled(client.get('key'), 1500)).outcome).toBe(
          'rejected: Command timed out'
        );
        server.speak();
        expect(await client.set('key', '1')).toBe('OK');
      }
      expect(server.state.connections).toBe(1);
    } finally {
      client.disconnect();
      await server.close();
    }
  });
});
