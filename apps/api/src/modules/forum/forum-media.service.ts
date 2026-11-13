import type { PokergosuDetail, PokergosuImage } from '@app/shared/monitoring/contracts/pokergosu';
import { supportedPokergosuImage } from '@app/shared/monitoring/domain/pokergosu-media';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { monitoringJobs } from '../../db/schema.js';
import { AppError } from '../../shared/errors/app-error.js';
import { AssetRepository, boardMediaPath } from '../assets/asset.repository.js';
import { ForumRepository } from './forum.repository.js';
export async function fetchBoardImage(url: string) {
  if (!supportedPokergosuImage(url)) throw Error('UNSUPPORTED_IMAGE_URL');
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (!response.ok || !response.body) throw Error('IMAGE_FETCH_FAILED');
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 5 * 1024 * 1024) throw Error('IMAGE_TOO_LARGE');
      parts.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(parts);
}
@Injectable()
export class ForumMedia {
  constructor(
    private readonly forum: ForumRepository,
    private readonly assets: AssetRepository,
  ) {}
  async decorate(detail: PokergosuDetail) {
    const images = [...detail.images, ...detail.comments.flatMap((c) => c.images)];
    const cached = await this.assets.cachedPaths(images.map((image) => boardMediaPath(image.key)));
    const jobs = images.length
      ? await this.forum.db
          .select({ kind: monitoringJobs.kind, state: monitoringJobs.state })
          .from(monitoringJobs)
          .where(
            inArray(
              monitoringJobs.kind,
              images.map((image) => `forum-media:${image.key}`),
            ),
          )
      : [];
    for (const image of images) {
      if (cached.has(boardMediaPath(image.key))) image.state = 'cached';
      else {
        const job = jobs.find((row) => row.kind === `forum-media:${image.key}`);
        if (job?.state === 'failed') {
          image.state = 'failed';
          image.message = '이미지를 받지 못했습니다. 원문에서 확인해 주세요.';
        } else if (job?.state === 'queued' || job?.state === 'running') {
          image.state = 'not_cached';
          image.message = '이미지 보관 작업이 예약됐습니다.';
        } else if (image.state === 'cached') image.state = 'not_cached';
      }
    }
    return detail;
  }
  file(key: string) {
    return this.assets.get(boardMediaPath(key));
  }
  async request(id: string, key: string): Promise<PokergosuImage> {
    const detail = await this.forum.detail(id),
      image =
        detail &&
        [...detail.images, ...detail.comments.flatMap((c) => c.images)].find((i) => i.key === key);
    if (!image) throw new AppError('NOT_FOUND', '저장된 이미지 참조를 찾을 수 없습니다.', 404);
    if ((await this.assets.cachedPaths([boardMediaPath(key)])).size)
      return { ...image, state: 'cached' };
    if (!supportedPokergosuImage(image.url)) return { ...image, state: 'unsupported' };
    await this.forum.db
      .insert(monitoringJobs)
      .values({ kind: `forum-media:${key}`, revision: 0, payload: { id, key, url: image.url } })
      .onConflictDoUpdate({
        target: [monitoringJobs.kind, monitoringJobs.revision],
        set: { state: 'queued', errorCode: null },
        setWhere: eq(monitoringJobs.state, 'failed'),
      });
    await this.forum.db.execute(sql`select pg_notify('mention_forum_refresh','')`);
    return {
      ...image,
      state: 'not_cached',
      message: '이미지 보관 작업이 예약됐습니다. 잠시 후 다시 확인해 주세요.',
    };
  }
  /** Called only after the aggregate worker owns its lease. Image reads are idempotent. */
  async resume() {
    await this.forum.db
      .update(monitoringJobs)
      .set({ state: 'queued' })
      .where(
        and(sql`${monitoringJobs.kind} like 'forum-media:%'`, eq(monitoringJobs.state, 'running')),
      );
  }
  async processOne(load: (url: string) => Promise<Buffer> = fetchBoardImage) {
    const job = await this.forum.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(monitoringJobs)
        .where(
          and(sql`${monitoringJobs.kind} like 'forum-media:%'`, eq(monitoringJobs.state, 'queued')),
        )
        .orderBy(asc(monitoringJobs.pk))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      await tx
        .update(monitoringJobs)
        .set({ state: 'running' })
        .where(eq(monitoringJobs.pk, row.pk));
      return row;
    });
    if (!job) return false;
    try {
      const { id, key } = job.payload ?? {};
      if (typeof id !== 'string' || typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
        throw Error('INVALID_MEDIA_JOB');
      const detail = await this.forum.detail(id),
        image =
          detail &&
          [...detail.images, ...detail.comments.flatMap((c) => c.images)].find(
            (i) => i.key === key,
          );
      if (!image || !supportedPokergosuImage(image.url)) throw Error('MEDIA_REFERENCE_CHANGED');
      if (!(await this.assets.cachedPaths([boardMediaPath(key)])).size)
        await this.assets.importImage(key, await load(image.url));
      await this.forum.db
        .update(monitoringJobs)
        .set({ state: 'done', updated: 1, finishedAt: new Date() })
        .where(eq(monitoringJobs.pk, job.pk));
    } catch {
      await this.forum.db
        .update(monitoringJobs)
        .set({ state: 'failed', errorCode: 'IMAGE_UNAVAILABLE', finishedAt: new Date() })
        .where(eq(monitoringJobs.pk, job.pk));
    }
    return true;
  }
}
