import 'reflect-metadata';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc, ZodValidationPipe } from 'nestjs-zod';
import { loadEnv } from './shared/config/load-env.js';

async function bootstrap() {
  // 1) env 출처 폭포를 먼저 병합(Parameter Store → env → .env). → config/runtime-configuration.md
  await loadEnv();

  // 2) 병합 후에 config(zod 검증)와 AppModule(APP_ROLE 분기)을 로드한다.
  const { config } = await import('./shared/config/index.js');
  if (config.APP_ROLE === 'migrate') {
    await import('./db/migrate.js');
    return;
  }
  if (config.APP_ROLE === 'import-forum-archive') {
    if (!config.FORUM_ARCHIVE_IMPORT_FILE) throw Error('FORUM_ARCHIVE_IMPORT_FILE_REQUIRED');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { importForumArchive } = await import('./modules/forum/import-forum-archive.js');
    const archive = new EvidenceRepository();
    const { ForumRepository } = await import('./modules/forum/forum.repository.js');
    const { ForumProcessor } = await import('./modules/forum/forum-processor.js');
    const { legacyForumSource } = await import('./modules/forum/legacy-forum-source.js');
    const forum = new ForumRepository(),
      processor = new ForumProcessor(forum);
    try {
      const result = await importForumArchive(
        config.FORUM_ARCHIVE_IMPORT_FILE,
        archive,
        async (row) => {
          const source = legacyForumSource(row);
          if (source) await processor.importSource(source.raw, source.checkedAt);
        },
      );
      await processor.queueImportReindex();
      const { default: pino } = await import('pino');
      pino().info({ event: 'forum_archive_import_complete', ...result });
    } finally {
      await Promise.all([archive.close(), forum.close()]);
    }
    return;
  }
  if (config.APP_ROLE === 'import-native-reference') {
    if (!config.NATIVE_REFERENCE_IMPORT_FILE) throw Error('NATIVE_REFERENCE_IMPORT_FILE_REQUIRED');
    const { readFile, stat } = await import('node:fs/promises');
    if ((await stat(config.NATIVE_REFERENCE_IMPORT_FILE)).size > 128 * 1024 * 1024)
      throw Error('NATIVE_REFERENCE_TOO_LARGE');
    const { parseOwnerJson } = await import('./modules/connection/owner-wire.js');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { importNativeReference } = await import('./modules/evidence/native-reference.js');
    const target = new EvidenceRepository();
    try {
      const value = parseOwnerJson(await readFile(config.NATIVE_REFERENCE_IMPORT_FILE, 'utf8'));
      const result = await importNativeReference(value, target);
      const { importNativeMessages } = await import('./modules/context/import-native-messages.js');
      const messages = await importNativeMessages(value, target);
      const { default: pino } = await import('pino');
      pino().info({ event: 'native_reference_import_complete', ...result, messages });
    } finally {
      await target.close();
    }
    return;
  }
  if (config.APP_ROLE === 'import-native-guide') {
    if (!config.NATIVE_STATE_SNAPSHOT_ID) throw Error('NATIVE_STATE_SNAPSHOT_ID_REQUIRED');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { GuideRepository } = await import('./modules/monitoring/guide.repository.js');
    const target = new EvidenceRepository();
    try {
      const result = await new GuideRepository(target).importSnapshot(
        config.NATIVE_STATE_SNAPSHOT_ID,
      );
      const { default: pino } = await import('pino');
      pino().info({ event: 'native_guide_import_complete', ...result });
    } finally {
      await target.close();
    }
    return;
  }
  if (config.APP_ROLE === 'import-native-rooms') {
    if (!config.NATIVE_STATE_SNAPSHOT_ID) throw Error('NATIVE_STATE_SNAPSHOT_ID_REQUIRED');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { RoomsRepository } = await import('./modules/monitoring/rooms.repository.js');
    const target = new EvidenceRepository();
    try {
      const result = await new RoomsRepository(target).importSnapshot(
        config.NATIVE_STATE_SNAPSHOT_ID,
      );
      const { default: pino } = await import('pino');
      pino().info({ event: 'native_rooms_import_complete', ...result });
    } finally {
      await target.close();
    }
    return;
  }
  if (config.APP_ROLE === 'import-native-photos') {
    if (!config.NATIVE_PHOTO_IMPORT_DIRECTORY)
      throw Error('NATIVE_PHOTO_IMPORT_DIRECTORY_REQUIRED');
    const { AssetRepository } = await import('./modules/assets/asset.repository.js');
    const { importNativePhotos } = await import('./modules/assets/import-native-photos.js');
    const assets = new AssetRepository();
    try {
      const result = await importNativePhotos(config.NATIVE_PHOTO_IMPORT_DIRECTORY, assets);
      const { default: pino } = await import('pino');
      pino().info({ event: 'native_photos_import_complete', ...result });
    } finally {
      await assets.close();
    }
    return;
  }
  if (config.APP_ROLE === 'import-native-state') {
    if (!config.NATIVE_STATE_IMPORT_FILE) throw Error('NATIVE_STATE_IMPORT_FILE_REQUIRED');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { importNativeState } = await import('./modules/evidence/import-native-state.js');
    const target = new EvidenceRepository();
    try {
      const result = await importNativeState(config.NATIVE_STATE_IMPORT_FILE, target);
      const { default: pino } = await import('pino');
      pino().info({ event: 'native_state_import_complete', ...result });
    } finally {
      await target.close();
    }
    return;
  }
  if (config.APP_ROLE === 'import-workspace') {
    if (!config.WORKSPACE_IMPORT_FILE) throw Error('WORKSPACE_IMPORT_FILE_REQUIRED');
    const { KeywordSettingsRepository } = await import(
      './modules/settings/keyword-settings.repository.js'
    );
    const { ForumRepository } = await import('./modules/forum/forum.repository.js');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { importWorkspace } = await import('./modules/forum/import-workspace.js');
    const { AssetRepository } = await import('./modules/assets/asset.repository.js');
    const settings = new KeywordSettingsRepository(),
      forum = new ForumRepository(),
      audit = new EvidenceRepository(),
      assets = new AssetRepository();
    try {
      const result = await importWorkspace(
        config.WORKSPACE_IMPORT_FILE,
        settings,
        forum,
        audit,
        assets,
      );
      const { default: pino } = await import('pino');
      pino().info({ event: 'workspace_import_complete', ...result });
    } finally {
      await Promise.all([settings.close(), forum.close(), audit.close(), assets.close()]);
    }
    return;
  }
  if (config.APP_ROLE === 'import-evidence') {
    const { MonitoringRepository } = await import('./modules/monitoring/monitoring.repository.js');
    const { EvidenceRepository } = await import('./modules/evidence/evidence.repository.js');
    const { importEvidence } = await import('./modules/evidence/import-evidence.js');
    const source = new MonitoringRepository({
      origin: config.MENTION_SOURCE_URL,
      timeoutMs: config.MENTION_SOURCE_TIMEOUT_MS,
    });
    const target = new EvidenceRepository();
    const { default: pino } = await import('pino');
    const log = pino();
    try {
      const progress = (done: number, total: number) => {
        if (done % 25 === 0 || done === total)
          log.info({ event: 'evidence_import_progress', done, total });
      };
      const result = config.EVIDENCE_IMPORT_FILE
        ? await (await import('./modules/evidence/import-evidence-file.js')).importEvidenceFile(
            config.EVIDENCE_IMPORT_FILE,
            target,
            progress,
          )
        : await importEvidence(source, target, progress);
      log.info({ event: 'evidence_import_complete', ...result });
    } finally {
      await target.close();
    }
    return;
  }
  if (config.APP_ROLE === 'register-collector') {
    if (!config.COLLECTOR_ID || !config.COLLECTOR_EXTENSION_ID || !config.COLLECTOR_TOKEN)
      throw new Error('COLLECTOR_REGISTRATION_ENV_REQUIRED');
    const { ForumStore } = await import('./modules/forum-intake/forum-store.js');
    const store = new ForumStore();
    try {
      await store.register(
        config.COLLECTOR_ID,
        config.COLLECTOR_EXTENSION_ID,
        config.COLLECTOR_TOKEN,
      );
    } finally {
      await store.close();
    }
    const { default: pino } = await import('pino');
    pino().info(
      { event: 'collector_registered', collector: config.COLLECTOR_ID },
      'Collector registered; token is not logged',
    );
    return;
  }
  const { AppModule } = await import('./app.module.js');
  if (config.WORKER_RUN_ONCE) {
    if (config.APP_ROLE !== 'worker') throw new Error('ONE_SHOT_REQUIRES_WORKER_ROLE');
    const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
    context.useLogger(context.get(Logger));
    await context.close();
    return;
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // ALB/프록시 뒤에서 X-Forwarded-For 기반 IP 를 쓰려면 trustProxy 필수(rate-limit 오탐 방지).
    new FastifyAdapter({ trustProxy: true, bodyLimit: 1 * 1024 * 1024 }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));

  // SIGTERM/SIGINT 에서 lifecycle hook(OnModuleDestroy 등) 실행. → deployment/graceful-shutdown.md
  app.enableShutdownHooks();
  // 시그널 수신 즉시 /health 를 503(draining)으로 — 정리 중인 인스턴스로 새 요청이 오지 않게.
  const { LifecycleState } = await import('./modules/health/lifecycle-state.js');
  const lifecycle = app.get(LifecycleState);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => lifecycle.markDraining());
  }

  // 검증 파이프(nestjs-zod) — 실패 시 ZodError → GlobalExceptionFilter 에서 VALIDATION_ERROR.
  app.useGlobalPipes(new ZodValidationPipe());

  // 보안 헤더. JSON API 라 CSP 는 의미가 적어 끈다(HSTS 등 나머지는 유지).
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: (origin, done) => {
      const extension =
        typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
      const allowed =
        (extension &&
          config.APP_ROLE.split(',').some((role) => ['all', 'ingest'].includes(role.trim()))) ||
        !origin ||
        config.CORS_ORIGINS.length === 0 ||
        config.CORS_ORIGINS.includes(origin);
      done(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);

  // 전역 rate limit(안전망). → api/05-rate-limiting.md
  // 코어에는 Valkey 가 없으므로 인메모리 store 로 시작한다.
  // ⚠️ 인스턴스가 2대 이상이 되면 한도가 인스턴스 수만큼 늘어난다. Valkey 블록 도입 시
  //    `redis: valkeyClient` 옵션으로 교체해 카운터를 공유해야 한다(인메모리 → Valkey).
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // /health 는 한도에서 제외 — ALB 헬스체크가 429 로 죽지 않게.
    allowList: (req: FastifyRequest) =>
      req.url === '/health' || req.url.startsWith('/api/v1/health'),
    errorResponseBuilder: () => ({
      success: false,
      data: null,
      error: {
        code: 'RATE_LIMITED',
        message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      },
    }),
  });

  // Swagger — 비프로덕션 또는 ENABLE_SWAGGER=true.
  if (config.NODE_ENV !== 'production' || config.ENABLE_SWAGGER) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API')
        .setDescription('공통 코어 API')
        .setVersion('1.0')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(doc));
  }

  // 없는 경로 → NestJS 가 NotFoundException 을 던지고 GlobalExceptionFilter 가
  // envelope 404(code: NOT_FOUND)로 변환한다. 별도 핸들러 불필요.

  await app.listen(config.PORT, '0.0.0.0');
  app.get(Logger).log(`API server running on port ${config.PORT} (APP_ROLE=${config.APP_ROLE})`);
}

bootstrap().catch((error) => {
  // 부팅 자체가 실패하면 최소한 stderr 로 남기고 죽는다.
  console.error('Bootstrap failed:', error);
  process.exit(1);
});
