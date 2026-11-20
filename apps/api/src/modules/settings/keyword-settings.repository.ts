import { createHash } from 'node:crypto';
import {
  sharedPolicy,
  sourceKeywords,
  validateKeywordPolicy,
} from '@app/shared/monitoring/contracts/keyword-policy';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { Injectable } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createDatabase } from '../../db/client.js';
import { monitoringJobs, monitoringSettings } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { stableJson } from '../connection/stable-json.js';

const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
type SettingsTransaction = Parameters<
  Parameters<ReturnType<typeof createDatabase>['db']['transaction']>[0]
>[0];
const exclusions = z.array(z.string().trim().min(1).max(200)).max(100);
@Injectable()
export class KeywordSettingsRepository {
  private connection?: ReturnType<typeof createDatabase>;
  get db() {
    if (!this.connection) {
      if (!config.DATABASE_URL) throw Error('DATABASE_REQUIRED');
      this.connection = createDatabase(config.DATABASE_URL);
    }
    return this.connection.db;
  }
  async onApplicationShutdown() {
    await this.close();
  }
  async close() {
    await this.connection?.pool.end();
    this.connection = undefined;
  }
  async importSnapshot(input: Record<string, unknown>) {
    const policy = validateKeywordPolicy(sharedPolicy(input)),
      exclude = [...new Set(exclusions.parse(input.exclude_keywords ?? []))];
    const token = z.string().min(1).parse(input.keyword_policy_token);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271816,1)`);
      const [existing] = await tx
        .select()
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'))
        .for('update');
      if (existing?.revision)
        throw new AppError(
          'LOCAL_SETTINGS_EXIST',
          '새 서버에서 수정한 설정을 덮어쓸 수 없습니다.',
          409,
        );
      await tx
        .insert(monitoringSettings)
        .values({
          key: 'keywords',
          value: {
            ...input,
            keyword_policy: policy,
            exclude_keywords: exclude,
            keyword_policy_token: token,
          },
        })
        .onConflictDoUpdate({
          target: monitoringSettings.key,
          set: {
            value: {
              ...input,
              keyword_policy: policy,
              exclude_keywords: exclude,
              keyword_policy_token: token,
            },
            updatedAt: new Date(),
          },
        });
    });
  }
  async read() {
    const [row] = await this.db
      .select()
      .from(monitoringSettings)
      .where(eq(monitoringSettings.key, 'keywords'));
    if (!row)
      throw new AppError('SETTINGS_NOT_READY', '키워드 설정 이전이 완료되지 않았습니다.', 503);
    return row.value;
  }
  async policy() {
    const value = await this.read();
    return {
      policy: validateKeywordPolicy(sharedPolicy(value)),
      token: String(value.keyword_policy_token),
      supported: true,
    };
  }
  async processing() {
    const [row] = await this.db
      .select()
      .from(monitoringJobs)
      .where(eq(monitoringJobs.kind, 'keyword-reindex'))
      .orderBy(desc(monitoringJobs.pk))
      .limit(1);
    return {
      supported: true,
      state: row?.state ?? 'idle',
      updated: row?.updated ?? 0,
      revision: row?.revision ?? 0,
    };
  }
  async forumProcessing() {
    const [row] = await this.db
      .select()
      .from(monitoringJobs)
      .where(inArray(monitoringJobs.kind, ['keyword-reindex', 'forum-reindex']))
      .orderBy(desc(monitoringJobs.pk))
      .limit(1);
    const stage = row?.payload?.forum_state;
    return {
      state:
        stage === 'completed'
          ? 'completed'
          : stage === 'failed'
            ? 'failed'
            : stage === 'running'
              ? 'running'
              : (row?.state ?? 'idle'),
      updated: row?.updated ?? 0,
      revision: row?.revision ?? 0,
    };
  }
  async save(value: Record<string, unknown>, transaction?: SettingsTransaction) {
    let policy: ReturnType<typeof validateKeywordPolicy>;
    try {
      policy = validateKeywordPolicy(value.keyword_policy);
    } catch {
      throw new AppError('INVALID_KEYWORD_POLICY', '대상·별칭과 출처 설정을 확인해 주세요.', 400);
    }
    const exclude = [...new Set(exclusions.parse(value.exclude_keywords ?? []))];
    const save = async (tx: SettingsTransaction) => {
      await tx.execute(sql`select pg_advisory_xact_lock(271816,1)`);
      const [row] = await tx
        .select()
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'))
        .for('update');
      if (!row)
        throw new AppError('SETTINGS_NOT_READY', '키워드 설정 이전이 완료되지 않았습니다.', 503);
      if (value.keyword_policy_token !== row.value.keyword_policy_token)
        throw new AppError(
          'SETTINGS_CONFLICT',
          '다른 곳에서 키워드가 변경됐습니다. 새로고침해 주세요.',
          409,
        );
      const revision = row.revision + 1,
        keywords = sourceKeywords(policy, 'kakao');
      const groups = policy.keyword_groups
        .map((g) => ({ ...g, keywords: g.keywords.filter((word) => keywords.includes(word)) }))
        .filter((g) => g.keywords.length);
      const token = hash([policy, exclude, revision]);
      await tx
        .update(monitoringSettings)
        .set({
          revision,
          value: {
            ...row.value,
            keywords,
            exclude_keywords: exclude,
            keyword_groups: groups,
            keyword_policy: policy,
            keyword_policy_token: token,
            keyword_policy_supported: true,
            source_keywords: { kakao: keywords, pokergosu: sourceKeywords(policy, 'pokergosu') },
          },
          updatedAt: new Date(),
        })
        .where(eq(monitoringSettings.pk, row.pk));
      await tx.insert(monitoringJobs).values({ kind: 'keyword-reindex', revision });
      // No host socket, setting propagation, inline reindex or aggregate work.
      await tx.execute(sql`select pg_notify('mention_keyword_reindex','')`);
      return {
        ok: true,
        processing: { state: 'queued', revision },
        forum_processing: { state: 'queued', revision },
      };
    };
    return transaction ? save(transaction) : this.db.transaction(save);
  }
  async check(value: Record<string, unknown>) {
    const saved = await this.policy();
    const words = z
      .array(z.string().min(1).max(200))
      .max(100)
      .parse(value.keywords ?? saved.policy.keywords);
    const exclude = exclusions.parse(value.exclude_keywords ?? []),
      sample = z
        .string()
        .max(8000)
        .parse(value.sample ?? '');
    const matched = keywordMatches(sample, words),
      excluded = matchingExclusions(sample, exclude);
    const groups = Array.isArray(value.keyword_groups)
      ? value.keyword_groups
      : saved.policy.keyword_groups;
    const policy = validateKeywordPolicy({
      ...saved.policy,
      keywords: words,
      keyword_groups: groups,
      sources: { kakao: { disabled: [] }, pokergosu: { disabled: [] } },
    });
    const targets = [
      ...new Set(
        matched.map(
          (word) => policy.keyword_groups.find((g) => g.keywords.includes(word))?.name ?? word,
        ),
      ),
    ];
    return { save: matched.length > 0 && !excluded.length, matched, excluded, targets };
  }
}
