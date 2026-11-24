import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { OwnerClient } from './owner-client.js';
import { decodeOwnerValue, encodeOwnerValue } from './owner-wire.js';

let server: Server | undefined, root: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server?.close(() => r()));
  if (root) await rm(root, { recursive: true, force: true });
  server = undefined;
  root = undefined;
});
it('calls only a synthetic Unix socket, preserving cursors and HTTP origin', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mention-owner-'));
  const socket = path.join(root, 'owner.sock');
  const seen: unknown[] = [];
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const value = decodeOwnerValue(JSON.parse(Buffer.concat(chunks).toString()));
    seen.push(value);
    expect(req.headers.host).toBe('connection.local');
    expect(req.headers.origin).toBe('http://connection.local');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        encodeOwnerValue({
          ok: true,
          state: {
            connected: true,
            instance_id: 'synthetic',
            event_cursor: 'synthetic:owner:3',
            initial_cursor: 'synthetic:owner:0',
            event_capacity: 20000,
            stream_error: null,
          },
          result: { events: [], next_cursor: 'synthetic:owner:3' },
          cache: {},
        }),
      ),
    );
  });
  await new Promise<void>((r) => server?.listen(socket, r));
  const client = new OwnerClient(socket);
  await client.status();
  await client.events('synthetic:owner:2');
  expect(seen).toEqual([
    { method: 'status', params: {} },
    { method: 'events', params: { cursor: 'synthetic:owner:2', limit: 100, wait_seconds: 5 } },
  ]);
});
it('does not retry or attempt authentication when a socket is unavailable', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mention-owner-'));
  await expect(new OwnerClient(path.join(root, 'missing.sock')).status()).rejects.toThrow();
});
it('reads a private Mention token file and reports scoped endpoint rejection', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mention-owner-'));
  const socket = path.join(root, 'owner.sock');
  const file = path.join(root, 'collector.token');
  const token = `mention1_${'a'.repeat(43)}`;
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  let requests = 0;
  server = createServer((req, res) => {
    requests++;
    expect(req.headers.authorization).toBe(`Bearer ${token}`);
    res.writeHead(401).end();
  });
  await new Promise<void>((r) => server?.listen(socket, r));
  const client = new OwnerClient(socket, 10000, file);
  await expect(client.status()).rejects.toThrow('OWNER_COLLECTOR_AUTH_REJECTED');
  await chmod(file, 0o644);
  await expect(client.status()).rejects.toThrow('INVALID_KAKAO_COLLECTOR_TOKEN_FILE');
  expect(requests).toBe(1);
});
