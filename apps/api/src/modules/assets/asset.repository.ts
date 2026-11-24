import { createHash } from 'node:crypto';
import { sharedPolicy, sourceKeywords } from '@app/shared/monitoring/contracts/keyword-policy';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';
import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client.js';
import { monitoringAssets, monitoringSettings, nativePhotoAssets } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
import { AppError } from '../../shared/errors/app-error.js';
import { matchingExclusions } from '../../shared/monitoring/exclusion-rules.js';

export const nativePhotoPath = /^\/photo\/[1-9][0-9]{0,18}\/[1-9][0-9]{0,18}\/[0-9]{1,3}$/u;
type NativePhoto = Pick<
  typeof nativePhotoAssets.$inferInsert,
  'route' | 'messageText' | 'contextText' | 'filename'
>;
type NativePhotoImport = { photo: NativePhoto; digest: string; bytes: Buffer | null };
export const boardMediaPath = (key: string) => `/api/v1/monitoring/pokergosu/media/${key}`;
export function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  if (
    bytes.subarray(4, 8).toString('ascii') === 'ftyp' &&
    ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))
  )
    return 'image/avif';
  throw Error('UNSUPPORTED_IMAGE_BYTES');
}
@Injectable()
export class AssetRepository {
  private connection?: ReturnType<typeof createDatabase>;
  get db() {
    if (!this.connection) {
      if (!config.DATABASE_URL) throw Error('DATABASE_REQUIRED');
      this.connection = createDatabase(config.DATABASE_URL);
    }
    return this.connection.db;
  }
  async close() {
    await this.connection?.pool.end();
    this.connection = undefined;
  }
  async onApplicationShutdown() {
    await this.close();
  }
  async cachedPaths(paths: string[]) {
    if (!paths.length) return new Set<string>();
    const rows = await this.db
      .select({ path: monitoringAssets.path })
      .from(monitoringAssets)
      .where(inArray(monitoringAssets.path, paths));
    return new Set(rows.map((row) => row.path));
  }
  async get(path: string) {
    const [row] = await this.db
      .select()
      .from(monitoringAssets)
      .where(eq(monitoringAssets.path, path));
    return row ?? null;
  }
  async importImage(key: string, bytes: Buffer) {
    if (!/^[a-f0-9]{64}$/.test(key) || !bytes.length || bytes.length > 5 * 1024 * 1024)
      throw Error('INVALID_MEDIA_RECORD');
    const mime = imageMime(bytes),
      digest = createHash('sha256').update(bytes).digest('hex');
    await this.db
      .insert(monitoringAssets)
      .values({ path: boardMediaPath(key), mime, bytes, digest })
      .onConflictDoNothing();
  }

  async importNativePhoto(photo: NativePhoto, bytes: Buffer | null, digest: string) {
    await this.importNativePhotoBatch([{ photo, bytes, digest }]);
  }

  async importNativePhotoBatch(batch: readonly NativePhotoImport[]) {
    if (!batch.length) return;
    const path = (digest: string) => `/internal/native-photo/${digest}`;
    const objects = new Map<
      string,
      { path: string; mime: string; bytes: Buffer; digest: string }
    >();
    for (const { bytes, digest } of batch) {
      if (
        !/^[a-f0-9]{64}$/u.test(digest) ||
        (bytes &&
          (!bytes.length ||
            bytes.length > 32 * 1024 * 1024 ||
            createHash('sha256').update(bytes).digest('hex') !== digest))
      )
        throw Error('INVALID_NATIVE_PHOTO_BYTES');
      if (!bytes) continue;
      let mime = 'application/octet-stream';
      try {
        mime = imageMime(bytes);
      } catch {
        // Unrecognized legacy formats remain downloadable as opaque attachments.
      }
      objects.set(digest, { path: path(digest), mime, bytes, digest });
    }
    await this.db.transaction(async (tx) => {
      if (objects.size)
        await tx
          .insert(monitoringAssets)
          .values([...objects.values()])
          .onConflictDoNothing();
      const keys = [...new Set(batch.map(({ digest }) => path(digest)))];
      const assets = await tx
        .select({ pk: monitoringAssets.pk, path: monitoringAssets.path })
        .from(monitoringAssets)
        .where(inArray(monitoringAssets.path, keys));
      const identifiers = new Map(assets.map((asset) => [asset.path, asset.pk]));
      const links = batch.map(({ photo, digest }) => {
        const assetPk = identifiers.get(path(digest));
        if (!assetPk) throw Error('NATIVE_PHOTO_STORAGE_FAILED');
        return { ...photo, assetPk };
      });
      await tx
        .insert(nativePhotoAssets)
        .values(links)
        .onConflictDoUpdate({
          target: nativePhotoAssets.route,
          set: {
            assetPk: sql`excluded.asset_pk`,
            messageText: sql`excluded.message_text`,
            contextText: sql`excluded.context_text`,
            filename: sql`excluded.filename`,
          },
        });
    });
  }

  async nativePhoto(endpoint: string) {
    const url = new URL(endpoint, 'http://photo.local');
    const invalid = () => new AppError('ASSET_UNAVAILABLE', '파일을 가져오지 못했습니다.', 404);
    if (url.origin !== 'http://photo.local' || !nativePhotoPath.test(url.pathname)) throw invalid();
    const route = url.pathname + (url.searchParams.get('thumb') === '1' ? '?thumb=1' : '');
    const [photo] = await this.db
      .select()
      .from(nativePhotoAssets)
      .where(eq(nativePhotoAssets.route, route));
    const [settings] = await this.db
      .select({ value: monitoringSettings.value })
      .from(monitoringSettings)
      .where(eq(monitoringSettings.key, 'keywords'));
    if (!photo || !settings) throw invalid();
    const excludes = Array.isArray(settings.value.exclude_keywords)
      ? settings.value.exclude_keywords.filter((rule): rule is string => typeof rule === 'string')
      : [];
    const allowed = (body: string | null | undefined) =>
      body != null && !matchingExclusions(body, excludes).length;
    if (
      !allowed(photo.contextText) &&
      !(
        photo.messageText != null &&
        allowed(photo.messageText) &&
        keywordMatches(photo.messageText, sourceKeywords(sharedPolicy(settings.value), 'kakao'))
          .length
      )
    )
      throw invalid();
    const [asset] = await this.db
      .select()
      .from(monitoringAssets)
      .where(eq(monitoringAssets.pk, photo.assetPk));
    if (!asset) throw invalid();
    return {
      bytes: asset.bytes,
      contentType: asset.mime,
      disposition:
        url.searchParams.has('download') || asset.mime === 'application/octet-stream'
          ? `attachment; filename="${photo.filename}"`
          : null,
    };
  }
}
