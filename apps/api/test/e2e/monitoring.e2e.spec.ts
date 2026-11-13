import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { MONITORING_SOURCE } from '../../src/modules/monitoring/monitoring.repository.js';
import { config } from '../../src/shared/config/index.js';

describe('read-only monitoring migration contracts', () => {
  let app: NestFastifyApplication, source: Server;
  let mode = 'ok';
  const calls: {
    method?: string;
    url?: string;
    publicHeader?: string | string[];
    origin?: string;
    forwarded?: string | string[];
    body?: unknown;
  }[] = [];
  const data = {
    overview: { targets: [{ name: '합성 대상', classified: 2, excluded: 1, conversations: 4 }] },
    origin: 'human',
    stale: true,
    expected: 'synthetic-evidence-token',
    id: 'synthetic-canonical-1',
    nextCursor: 'synthetic-next-cursor',
    messages: [
      {
        id: '1001',
        text: '합성 반응',
        promotionReference: {
          logId: '900',
          at: 1793850000000,
          keywords: ['합성 대상'],
          targets: ['합성 대상'],
          method: 'topic_candidate',
          ambiguousTargets: false,
        },
      },
    ],
  };
  beforeAll(async () => {
    source = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk.toString();
      calls.push({
        method: req.method,
        url: req.url,
        publicHeader: req.headers['x-monitor-public'],
        origin: req.headers.origin,
        forwarded: req.headers['x-forwarded-for'],
        body: raw ? JSON.parse(raw) : undefined,
      });
      if (mode === 'conflict') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ success: false, data: null, error: { message: '합성 맥락 충돌' } }),
        );
        return;
      }
      if (mode === 'redirect') {
        res.writeHead(302, { Location: '/must-not-follow' });
        res.end();
        return;
      }
      if (mode === 'malformed') {
        res.writeHead(200);
        res.end('private source error');
        return;
      }
      if (mode === 'missing') {
        res.writeHead(404);
        res.end('private path');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data, error: null }));
    });
    await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', resolve));
    const port = (source.address() as AddressInfo).port;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MONITORING_SOURCE)
      .useValue({ origin: `http://127.0.0.1:${port}`, timeoutMs: 1000 })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => {
    mode = 'ok';
    config.MENTION_WRITES_ENABLED = false;
    calls.length = 0;
  });
  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      source.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('preserves classification origin, stale evidence and cursor data in one envelope', async () => {
    for (const path of [
      'overview',
      'conversations',
      'classifications',
      'conversations/synthetic-canonical-1',
    ]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/monitoring/${path}`)
        .expect(200);
      expect(response.body).toEqual({ success: true, data, error: null });
    }
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.method === 'GET' && call.publicHeader === '1')).toBe(true);
  });
  it('shares bounded calendar/filter validation and never sends rejected input upstream', async () => {
    for (const query of ['limit=51', 'day=2026-02-30', 'label=invalid', 'status=invalid']) {
      await request(app.getHttpServer())
        .get(`/api/v1/monitoring/conversations?${query}`)
        .expect(400);
    }
    expect(calls).toHaveLength(0);
    await request(app.getHttpServer())
      .get('/api/v1/monitoring/conversations?day=2026-11-12&target=APL&limit=15')
      .expect(200);
    const url = new URL(calls[0]?.url ?? '', 'http://localhost');
    expect(url.pathname).toBe('/api/conversations');
    expect(url.searchParams.get('day')).toBe('2026-11-12');
    expect(url.searchParams.get('limit')).toBe('15');
  });
  it('has no mutation endpoint, even for a caller claiming a local origin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/classifications')
      .set('Origin', 'http://localhost:4200')
      .send({ verdict: 'positive' })
      .expect(404);
    expect(calls).toHaveLength(0);
  });
  it('does not follow source redirects or expose malformed source text', async () => {
    mode = 'redirect';
    await request(app.getHttpServer()).get('/api/v1/monitoring/overview').expect(503);
    expect(calls).toHaveLength(1);
    mode = 'malformed';
    const response = await request(app.getHttpServer())
      .get('/api/v1/monitoring/overview')
      .expect(502);
    expect(JSON.stringify(response.body)).not.toContain('private source error');
    mode = 'missing';
    await request(app.getHttpServer()).get('/api/v1/monitoring/conversations/missing').expect(404);
    await request(app.getHttpServer()).get('/health').expect(200);
  });
  it('guards writes and keeps request identity/evidence intact without retry', async () => {
    const input = {
      id: 'synthetic-canonical-1',
      service: '합성 대상',
      verdict: 'positive',
      summary: '합성 검증',
      expected: 'immutable-evidence',
      request_id: 'cc87d0d9-3b9e-46c4-a74f-af47d53c2e94',
    };
    const api = () =>
      request(app.getHttpServer())
        .post('/api/v1/monitoring/classifications/correct')
        .set('Origin', 'http://127.0.0.1:4200')
        .send(input);
    await api().expect(403);
    expect(calls).toHaveLength(0);
    config.MENTION_WRITES_ENABLED = true;
    await api().expect(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual(input);
    mode = 'conflict';
    const conflict = await api().expect(409);
    expect(conflict.body.error.message).toBe('합성 맥락 충돌');
    expect(calls).toHaveLength(2);
  });
  it('blocks forwarded local-only actions and leaves ordinary public writes unprivileged', async () => {
    config.MENTION_WRITES_ENABLED = true;
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/actions/campaign-send')
      .set('Origin', 'http://127.0.0.1:4200')
      .set('X-Forwarded-For', '127.0.0.1')
      .send({ request_id: 'synthetic-only' })
      .expect(403);
    expect(calls).toHaveLength(0);
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/actions/keyword-check')
      .set('Origin', 'http://127.0.0.1:4200')
      .set('X-Forwarded-For', '127.0.0.1')
      .send({ text: '합성 예시' })
      .expect(201);
    expect(calls[0]?.forwarded).toBe('0.0.0.0');
    expect(calls[0]?.method).toBe('POST');
    config.MENTION_WRITES_ENABLED = false;
  });
  it('refreshes completed views without source calls or collection work while writes are disabled', async () => {
    config.MENTION_WRITES_ENABLED = false;
    await request(app.getHttpServer())
      .post('/api/v1/monitoring/refresh')
      .set('Origin', 'https://untrusted.invalid')
      .send({})
      .expect(403);
    const response = await request(app.getHttpServer())
      .post('/api/v1/monitoring/refresh')
      .set('Origin', 'http://127.0.0.1:4200')
      .send({})
      .expect(201);
    expect(response.body.data).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
});
