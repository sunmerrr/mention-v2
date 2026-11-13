import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { createDatabase } from '../../db/client.js';
import { monitoringAssets } from '../../db/schema.js';
import { config } from '../../shared/config/index.js';
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
}
