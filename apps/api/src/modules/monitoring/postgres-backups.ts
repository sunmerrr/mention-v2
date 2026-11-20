import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { z } from 'zod';
import { monitoringBackups } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { EvidenceRepository } from '../evidence/evidence.repository.js';

const jobs = ['queued', 'verify_queued', 'working', 'verifying'];
const revoked = () =>
  new AppError(
    'BACKUP_NOT_CONFIGURED',
    '서버에 PostgreSQL 백업 디렉터리가 설정되지 않았습니다.',
    503,
  );
const duration = 45 * 60_000;
function postgresEnvironment(dsn: string, temporary?: string) {
  const url = new URL(dsn);
  return {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/gu, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: temporary ?? decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer',
    PGCONNECT_TIMEOUT: '5',
  };
}
function execute(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: duration,
      killSignal: 'SIGKILL',
    });
    const chunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${command} 종료 ${code ?? signal}: ${Buffer.concat(chunks).toString('utf8')}`),
        );
    });
  });
}

@Injectable()
export class PostgresBackups implements OnModuleDestroy {
  private flight?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly evidence: EvidenceRepository,
    private readonly errors: SystemErrorService,
  ) {}

  async list() {
    const rows = await this.evidence.db
      .select()
      .from(monitoringBackups)
      .orderBy(desc(monitoringBackups.createdAt))
      .limit(40);
    return {
      busy: rows.some((row) => jobs.includes(row.state)),
      error: rows.find((row) => row.error)?.error ?? null,
      backups: rows
        .filter((row) => row.bytes !== null)
        .map((row) => ({
          id: row.id,
          bytes: row.bytes,
          created_at: row.createdAt.toISOString(),
          restore_tested_at: row.verifiedAt?.toISOString() ?? null,
          state: row.state,
        })),
      policy: '서버의 PostgreSQL 데이터베이스 백업과 임시 복구 검증',
      scope: config.MENTION_BACKUP_DIRECTORY
        ? '자동 복구 대신 검증 결과를 보관합니다.'
        : '백업 디렉터리가 설정되지 않았습니다.',
    };
  }

  async enqueue() {
    if (!config.MENTION_BACKUP_DIRECTORY) throw revoked();
    return this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271830,1)`);
      const [existing] = await tx
        .select({ id: monitoringBackups.id, state: monitoringBackups.state })
        .from(monitoringBackups)
        .where(inArray(monitoringBackups.state, jobs))
        .limit(1);
      if (existing) return existing;
      const [saved] = await tx
        .insert(monitoringBackups)
        .values({})
        .returning({ id: monitoringBackups.id, state: monitoringBackups.state });
      return saved;
    });
  }

  async verify(value: unknown) {
    if (!config.MENTION_BACKUP_DIRECTORY) throw revoked();
    const id = z.uuid().parse(value);
    const [row] = await this.evidence.db
      .update(monitoringBackups)
      .set({ state: 'verify_queued', error: null, touchedAt: new Date() })
      .where(and(eq(monitoringBackups.id, id), eq(monitoringBackups.state, 'available')))
      .returning({ id: monitoringBackups.id, state: monitoringBackups.state });
    if (!row)
      throw new AppError('BACKUP_NOT_AVAILABLE', '확인할 수 있는 백업을 선택해 주세요.', 409);
    return row;
  }

  @Interval('monitoring-postgres-backups', 5000)
  tick() {
    const dsn = config.DATABASE_URL,
      directory = config.MENTION_BACKUP_DIRECTORY;
    if (this.stopping || !directory || !dsn || config.MONITORING_EVIDENCE_BACKEND !== 'postgres')
      return;
    this.flight ??= this.process(directory, dsn)
      .catch((error: unknown) => this.errors.log('postgres_backup_worker_failed', error))
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  private async process(directory: string, dsn: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await realpath(directory)) !== directory || ((await stat(directory)).mode & 0o077) !== 0)
      throw Error('POSTGRES_BACKUP_DIRECTORY_NOT_PRIVATE');
    const job = await this.evidence.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271830,2)`);
      const [active] = await tx
        .select({ id: monitoringBackups.id })
        .from(monitoringBackups)
        .where(
          and(
            inArray(monitoringBackups.state, ['working', 'verifying']),
            sql`${monitoringBackups.touchedAt} >= now()-interval '2 hours'`,
          ),
        )
        .limit(1);
      if (active) return null;
      const [row] = await tx
        .select()
        .from(monitoringBackups)
        .where(
          or(
            inArray(monitoringBackups.state, ['queued', 'verify_queued']),
            and(
              inArray(monitoringBackups.state, ['working', 'verifying']),
              lt(monitoringBackups.touchedAt, sql`now()-interval '2 hours'`),
            ),
          ),
        )
        .orderBy(asc(monitoringBackups.createdAt))
        .limit(1)
        .for('update');
      if (!row) return null;
      const verify = ['verify_queued', 'verifying'].includes(row.state);
      await tx
        .update(monitoringBackups)
        .set({ state: verify ? 'verifying' : 'working', touchedAt: sql`now()` })
        .where(eq(monitoringBackups.id, row.id));
      return { ...row, verify };
    });
    if (!job) return;
    const file = join(directory, `mention-${job.id}.dump`);
    try {
      if (job.verify) {
        if ((await realpath(file)) !== file || (await stat(file)).size !== job.bytes)
          throw Error('POSTGRES_BACKUP_FILE_CHANGED');
        await this.restore(dsn, file);
        await this.evidence.db
          .update(monitoringBackups)
          .set({ state: 'available', verifiedAt: new Date(), error: null })
          .where(eq(monitoringBackups.id, job.id));
      } else {
        const temporary = await mkdtemp(join(directory, 'dump-'));
        try {
          const stage = join(temporary, 'snapshot.dump');
          await execute(
            'pg_dump',
            ['--format=custom', '--compress=1', '--no-acl', '--no-owner', '--file', stage],
            postgresEnvironment(dsn),
          );
          const { size } = await stat(stage);
          await rename(stage, file);
          await this.evidence.db
            .update(monitoringBackups)
            .set({ state: 'available', bytes: size, error: null })
            .where(eq(monitoringBackups.id, job.id));
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      }
    } catch (error) {
      this.errors.log(
        job.verify ? 'postgres_restore_verification_failed' : 'postgres_backup_failed',
        error,
      );
      await this.evidence.db
        .update(monitoringBackups)
        .set({
          state: job.verify ? 'available' : 'failed',
          error: job.verify ? '복구 검증 실패' : '백업 생성 실패',
        })
        .where(eq(monitoringBackups.id, job.id));
    }
  }
  private async restore(dsn: string, file: string) {
    const temporary = `mention_verify_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: dsn, max: 1, connectionTimeoutMillis: 5000 });
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${temporary}" TEMPLATE template0`);
      created = true;
      await execute(
        'pg_restore',
        ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', temporary, file],
        postgresEnvironment(dsn, temporary),
      );
      const url = new URL(dsn);
      url.pathname = `/${temporary}`;
      const restored = new Pool({
        connectionString: url.href,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      try {
        const check = await restored.query(
          "select to_regclass('public.monitoring_projection_state') is not null ok",
        );
        if (!check.rows[0]?.ok) throw Error('POSTGRES_RESTORE_SCHEMA_MISSING');
      } finally {
        await restored.end();
      }
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE "${temporary}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
  async onModuleDestroy() {
    this.stopping = true;
    await this.flight;
  }
}
