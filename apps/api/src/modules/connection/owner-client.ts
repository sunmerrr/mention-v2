import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { request } from 'node:http';
import { isAbsolute } from 'node:path';
import { decodeOwnerValue, encodeOwnerValue, parseOwnerJson } from './owner-wire.js';

export interface OwnerState {
  connected: boolean;
  instance_id: string;
  event_cursor: string;
  initial_cursor: string;
  event_capacity: number;
  stream_error: string | null;
}
export interface OwnerReply {
  ok: true;
  state: OwnerState;
  result: unknown;
  cache: unknown;
}
/** A transport failure never triggers login, owner shutdown or mutation retry. */
export class OwnerClient {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = 10000,
    private readonly tokenFile?: string,
  ) {
    if (!isAbsolute(socketPath)) throw new Error('ABSOLUTE_OWNER_SOCKET_REQUIRED');
  }
  async status(signal?: AbortSignal): Promise<OwnerReply> {
    return this.call('status', {}, signal);
  }
  async events(cursor: string, signal?: AbortSignal): Promise<OwnerReply> {
    if (!cursor || cursor.length > 300) throw new Error('INVALID_OWNER_CURSOR');
    return this.call('events', { cursor, limit: 100, wait_seconds: 5 }, signal);
  }
  async downloadPhoto(roomId: string, logId: string, root: string, signal?: AbortSignal) {
    return this.call(
      'download_photo',
      { cid: BigInt(roomId), lid: BigInt(logId), root },
      signal,
      130_000,
    );
  }
  private async authorization() {
    if (!this.tokenFile) return {};
    const file = await open(
      this.tokenFile,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.mode & 0o077 || stat.size < 52 || stat.size > 53)
        throw new Error('INVALID_KAKAO_COLLECTOR_TOKEN_FILE');
      const token = (await file.readFile('utf8')).replace(/\n$/u, '');
      if (!/^mention1_[A-Za-z0-9_-]{43}$/u.test(token))
        throw new Error('INVALID_KAKAO_COLLECTOR_TOKEN');
      return { Authorization: `Bearer ${token}` };
    } finally {
      await file.close();
    }
  }
  private async call(
    method: 'status' | 'events' | 'download_photo',
    params: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<OwnerReply> {
    const payload = Buffer.from(JSON.stringify(encodeOwnerValue({ method, params })));
    const authorization = await this.authorization();
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          path: '/rpc',
          method: 'POST',
          signal,
          headers: {
            Host: 'connection.local',
            Origin: 'http://connection.local',
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            Connection: 'close',
            ...authorization,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) {
              response.destroy(new Error('OWNER_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.once('error', reject);
          response.once('end', () => {
            try {
              if (response.statusCode === 401 || response.statusCode === 403)
                throw new Error('OWNER_COLLECTOR_AUTH_REJECTED');
              if (response.statusCode !== 200) throw new Error('OWNER_RPC_UNAVAILABLE');
              const decoded = decodeOwnerValue(
                parseOwnerJson(Buffer.concat(chunks).toString('utf8')),
              ) as Partial<OwnerReply> & { code?: unknown };
              if (decoded.ok !== true)
                throw new Error(
                  typeof decoded.code === 'string' ? decoded.code : 'OWNER_RPC_FAILED',
                );
              if (
                !decoded.state ||
                typeof decoded.state.instance_id !== 'string' ||
                typeof decoded.state.connected !== 'boolean' ||
                typeof decoded.state.event_cursor !== 'string'
              )
                throw new Error('INVALID_OWNER_STATE');
              resolve(decoded as OwnerReply);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('OWNER_RPC_TIMEOUT')), timeoutMs);
      req.once('close', () => clearTimeout(timer));
      req.once('error', reject);
      req.end(payload);
    });
  }
}
