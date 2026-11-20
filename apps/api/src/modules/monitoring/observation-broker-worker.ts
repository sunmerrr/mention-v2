import { stat } from 'node:fs/promises';
import { request } from 'node:http';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { z } from 'zod';
import { config } from '../../shared/config/index.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { parseOwnerJson } from '../connection/owner-wire.js';
import { CampaignRegistry } from './campaign-registry.js';

const pendingShape = z.object({ items: z.array(z.unknown()).max(100) });
const ackShape = z.object({ ok: z.literal(true) });
async function brokerRequest(socketPath: string, path: '/pending' | '/ack', data?: unknown) {
  const socket = await stat(socketPath);
  if (!socket.isSocket() || (socket.mode & 0o077) !== 0)
    throw Error('OBSERVATION_SOCKET_NOT_PRIVATE');
  const body = data === undefined ? undefined : Buffer.from(JSON.stringify(data));
  return new Promise<unknown>((resolve, reject) => {
    const call = request(
      {
        socketPath,
        path,
        method: body ? 'POST' : 'GET',
        headers: {
          Host: 'observation.local',
          Connection: 'close',
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
              }
            : {}),
        },
        signal: AbortSignal.timeout(10_000),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.once('error', reject);
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) response.destroy(Error('OBSERVATION_RESPONSE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        response.once('end', () => {
          try {
            if (response.statusCode !== 200) throw Error(`OBSERVATION_HTTP_${response.statusCode}`);
            resolve(parseOwnerJson(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    call.once('error', reject);
    call.end(body);
  });
}
@Injectable()
export class ObservationBrokerWorker implements OnModuleInit, OnModuleDestroy {
  private flight?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly registry: CampaignRegistry,
    private readonly errors: SystemErrorService,
  ) {}
  onModuleInit() {
    return this.tick();
  }
  @Interval('confirmed-observation-broker', 15_000)
  tick() {
    const socket = config.KAKAO_OBSERVATION_SOCKET;
    if (
      this.stopping ||
      config.MONITORING_EVIDENCE_BACKEND !== 'postgres' ||
      !config.NATIVE_STATE_SNAPSHOT_ID
    )
      return;
    this.flight ??= this.poll(socket)
      .catch((error: unknown) => {
        this.errors.log('observation_poll_failed', error);
        if (config.WORKER_RUN_ONCE) throw error;
      })
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  private async poll(socket?: string) {
    if (socket) {
      const pending = pendingShape.parse(await brokerRequest(socket, '/pending'));
      for (const item of pending.items) {
        if (this.stopping) return;
        try {
          const outcome = await this.registry.confirmed(item);
          ackShape.parse(await brokerRequest(socket, '/ack', outcome));
        } catch (error) {
          this.errors.log('observation_item_failed', error);
        }
      }
    }
    await this.registry.updateActive();
  }
  async onModuleDestroy() {
    this.stopping = true;
    await this.flight;
  }
}
