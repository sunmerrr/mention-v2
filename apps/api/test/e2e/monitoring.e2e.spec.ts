import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { MONITORING_SOURCE } from '../../src/modules/monitoring/monitoring.repository.js';

describe('read-only monitoring migration contracts', () => {
  let app: NestFastifyApplication, source: Server;
  let mode = 'ok';
  const calls: { method?: string; url?: string; publicHeader?: string | string[] }[] = [];
  const data = {
    overview: { targets: [{ name: '합성 대상', classified: 2, excluded: 1, conversations: 4 }] },
    origin: 'human',
    stale: true,
    expected: 'synthetic-evidence-token',
    id: 'synthetic-canonical-1',
    nextCursor: 'synthetic-next-cursor',
  };
  beforeAll(async () => {
    source = createServer((req, res) => {
      calls.push({
        method: req.method,
        url: req.url,
        publicHeader: req.headers['x-monitor-public'],
      });
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
});
