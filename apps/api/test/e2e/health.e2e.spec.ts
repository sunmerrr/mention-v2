import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';

/**
 * 코어 e2e — 실제로 api 를 띄워 /health 200 과 없는 경로 → envelope 404 를 검증한다.
 * → testing/02-e2e-testcontainers.md (코어엔 DB 가 없어 supertest 로 끝단만 확인)
 *
 * 없는 경로는 NestJS 가 NotFoundException 을 던지고 GlobalExceptionFilter(APP_FILTER)가
 * envelope 404 로 변환한다.
 * DB/Valkey 블록을 도입하면 testcontainers globalSetup(test/global-setup.ts)을 켜서
 * 실제 컨테이너 위에서 검증한다.
 */
describe('Health & 404 (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // main.ts 와 동일하게 전역 검증 파이프를 붙여 검증 실패 → envelope 경로를 실제로 검증한다.
    app.useGlobalPipes(new ZodValidationPipe());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health → 200, envelope + status healthy', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe('healthy');
  });

  it('없는 경로 → 404 envelope (code NOT_FOUND)', async () => {
    const res = await request(app.getHttpServer()).get('/definitely/not/a/route').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/v1/examples → 200 envelope (빈 목록)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/examples').expect(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('검증 실패(빈 name) → 400 VALIDATION_ERROR (BAD_REQUEST 로 새지 않음)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/examples')
      .send({ name: '' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
