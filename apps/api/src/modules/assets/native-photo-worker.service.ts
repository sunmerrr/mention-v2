import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Injectable, type OnModuleDestroy, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import sharp from 'sharp';
import { monitoringRooms, monitoringSettings, nativePhotoJobs } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';
import { SystemErrorService } from '../../shared/services/system-error.service.js';
import { OwnerClient } from '../connection/owner-client.js';
import { AssetRepository } from './asset.repository.js';

const MAX_BYTES = 32 * 1024 * 1024;
const options = { limitInputPixels: 32_000_000 };
const MAX_ATTEMPTS = 4;
const LEASE_MS = 5 * 60 * 1000;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function prepareNativePhoto(original: Buffer) {
  const metadata = await sharp(original, options).metadata();
  let main = original;
  if ((metadata.pages ?? 1) === 1 && ['jpeg', 'png', 'webp'].includes(metadata.format)) {
    const encoder = sharp(original, options)
      .rotate()
      .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true });
    const compact = await encoder
      .toFormat(metadata.format, { quality: 88, progressive: metadata.format === 'jpeg' })
      .toBuffer();
    if (compact.length < original.length * 0.95) main = compact;
  }
  const thumbnail = await sharp(original, options)
    .rotate()
    .resize(480, 360, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer();
  const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  if (!['jpg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'].includes(extension))
    throw Error('UNSUPPORTED_NATIVE_PHOTO_FORMAT');
  return { main, thumbnail, extension };
}

async function readDownloadedPhoto(file: string, root: string) {
  if (dirname(file) !== root || (await realpath(file)) !== file)
    throw Error('NATIVE_PHOTO_PATH_DENIED');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES)
      throw Error('INVALID_NATIVE_PHOTO_SIZE');
    const data = Buffer.alloc(info.size);
    const result = await handle.read({ buffer: data, length: data.length, position: 0 });
    const end = await handle.read({ buffer: Buffer.alloc(1), length: 1, position: info.size });
    if (result.bytesRead !== info.size || end.bytesRead) throw Error('NATIVE_PHOTO_CHANGED');
    return data;
  } finally {
    await handle.close();
  }
}

@Injectable()
export class NativePhotoWorker implements OnModuleDestroy {
  private flight?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly assets: AssetRepository,
    @Optional() private readonly errors?: SystemErrorService,
  ) {}

  @Interval('kakao-photo', 4000)
  tick() {
    const root = config.KAKAO_NATIVE_MEDIA_DIRECTORY;
    if (
      this.stopping ||
      !root ||
      config.MONITORING_EVIDENCE_BACKEND !== 'postgres' ||
      !config.KAKAO_CONTEXT_ENABLED
    )
      return;
    this.flight ??= this.processOne(root, new OwnerClient(config.KAKAO_CONNECTION_SOCKET))
      .catch((error: unknown) => this.errors?.log('native_photo_worker_failed', error))
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }

  async processOne(root: string, owner: Pick<OwnerClient, 'downloadPhoto'>) {
    const db = this.assets.db;
    const job = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(nativePhotoJobs)
        .where(
          and(
            inArray(nativePhotoJobs.state, ['pending', 'working']),
            lte(nativePhotoJobs.after, new Date()),
          ),
        )
        .orderBy(asc(nativePhotoJobs.after), asc(nativePhotoJobs.pk))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;
      const [updated] = await tx
        .update(nativePhotoJobs)
        .set({
          state: 'working',
          attempts: candidate.attempts + 1,
          after: new Date(Date.now() + LEASE_MS),
        })
        .where(eq(nativePhotoJobs.pk, candidate.pk))
        .returning();
      return updated;
    });
    if (!job) return;
    const claimed = and(
      eq(nativePhotoJobs.pk, job.pk),
      eq(nativePhotoJobs.attempts, job.attempts),
      eq(nativePhotoJobs.state, 'working'),
    );
    if (job.attempts > MAX_ATTEMPTS) {
      await db.update(nativePhotoJobs).set({ state: 'failed' }).where(claimed);
      return;
    }
    let temp: string | undefined;
    let ownerFinished = false;
    try {
      const [room] = await db
        .select({ joined: monitoringRooms.joined, excluded: monitoringRooms.excluded })
        .from(monitoringRooms)
        .where(eq(monitoringRooms.roomId, job.roomId));
      const [policy] = await db
        .select({ value: monitoringSettings.value })
        .from(monitoringSettings)
        .where(eq(monitoringSettings.key, 'keywords'));
      if (!policy) throw Error('NATIVE_PHOTO_POLICY_UNAVAILABLE');
      const rules = Array.isArray(policy.value.exclude_keywords)
        ? policy.value.exclude_keywords.filter((rule): rule is string => typeof rule === 'string')
        : [];
      if (!room?.joined || room.excluded || matchingExclusions(job.text, rules).length) {
        await db.update(nativePhotoJobs).set({ state: 'excluded' }).where(claimed);
        return;
      }
      if (basename(root) !== 'mention-native') throw Error('NATIVE_PHOTO_STAGING_DIRECTORY_DENIED');
      await mkdir(root, { mode: 0o700, recursive: true });
      const mediaDirectory = await realpath(root);
      if (mediaDirectory !== root) throw Error('NATIVE_PHOTO_STAGING_DIRECTORY_DENIED');
      temp = await mkdtemp(join(mediaDirectory, 'item-'));
      const response = await owner.downloadPhoto(job.roomId, job.logId, temp);
      ownerFinished = true;
      const value = response.result as {
        chat_id?: unknown;
        log_id?: unknown;
        complete?: unknown;
        paths?: unknown;
      };
      if (
        !value ||
        value.chat_id !== job.roomId ||
        value.log_id !== job.logId ||
        value.complete !== true ||
        !Array.isArray(value.paths) ||
        value.paths.length < 1 ||
        value.paths.length > 30 ||
        !value.paths.every((file): file is string => typeof file === 'string')
      )
        throw Error('INVALID_NATIVE_PHOTO_DOWNLOAD');
      const photos = [];
      for (const [index, file] of value.paths.entries()) {
        const media = await prepareNativePhoto(await readDownloadedPhoto(file, temp));
        const url = `/photo/${job.roomId}/${job.logId}/${index}`;
        const thumbnail = `${url}?thumb=1`;
        const visibility = { messageText: null, contextText: job.text };
        await this.assets.importNativePhoto(
          { route: url, filename: `photo-${job.logId}-${index}.${media.extension}`, ...visibility },
          media.main,
          sha(media.main),
        );
        await this.assets.importNativePhoto(
          { route: thumbnail, filename: `photo-${job.logId}-${index}.jpg`, ...visibility },
          media.thumbnail,
          sha(media.thumbnail),
        );
        photos.push({ url, thumbnail });
      }
      await db.update(nativePhotoJobs).set({ state: 'ready', photos }).where(claimed);
    } catch (error) {
      this.errors?.log('native_photo_job_failed', error, { job: job.pk, attempt: job.attempts });
      await db
        .update(nativePhotoJobs)
        .set({
          state: job.attempts < MAX_ATTEMPTS ? 'pending' : 'failed',
          after: new Date(Date.now() + 15_000 * 2 ** job.attempts),
        })
        .where(claimed);
    } finally {
      // After a transport timeout the owner may still be writing its files.
      if (temp && ownerFinished) await rm(temp, { recursive: true, force: true });
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    await this.flight;
  }
}
