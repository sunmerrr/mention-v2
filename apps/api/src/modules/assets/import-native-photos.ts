import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { type AssetRepository, nativePhotoPath } from './asset.repository.js';

const record = z
  .object({
    route: z.string().refine((route) => nativePhotoPath.test(route.replace(/\?thumb=1$/u, ''))),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    filename: z.string().regex(/^photo-[0-9]{1,19}-[0-9]{1,3}\.[a-z0-9]{1,12}$/u),
    messageText: z.string().nullable(),
    contextText: z.string().nullable(),
  })
  .strict();

export async function importNativePhotos(root: string, assets: AssetRepository) {
  const directory = await realpath(root);
  const manifest = resolve(directory, 'manifest.jsonl');
  if (
    (await stat(directory)).mode & 0o077 ||
    (await stat(manifest)).mode & 0o077 ||
    (await realpath(manifest)) !== manifest
  )
    throw Error('PRIVATE_NATIVE_PHOTO_BUNDLE_REQUIRED');
  const lines = createInterface({ input: createReadStream(manifest), crlfDelay: Infinity });
  const seen = new Set<string>();
  const objects = new Set<string>();
  let batch: Parameters<AssetRepository['importNativePhotoBatch']>[0][number][] = [];
  let bufferedBytes = 0;
  let routes = 0;
  for await (const line of lines) {
    const { digest, ...photo } = record.parse(JSON.parse(line));
    if (seen.has(photo.route)) throw Error('DUPLICATE_NATIVE_PHOTO_ROUTE');
    seen.add(photo.route);
    let bytes: Buffer | null = null;
    if (!objects.has(digest)) {
      const path = resolve(directory, 'objects', digest);
      const info = await stat(path);
      if (
        (await realpath(path)) !== path ||
        !info.isFile() ||
        info.mode & 0o077 ||
        info.size < 1 ||
        info.size > 32 * 1024 * 1024
      )
        throw Error('INVALID_NATIVE_PHOTO_OBJECT');
      bytes = await readFile(path);
    }
    if (
      batch.length >= 64 ||
      (batch.length && bufferedBytes + (bytes?.length ?? 0) > 8 * 1024 * 1024)
    ) {
      await assets.importNativePhotoBatch(batch);
      batch = [];
      bufferedBytes = 0;
    }
    batch.push({ photo, bytes, digest });
    bufferedBytes += bytes?.length ?? 0;
    objects.add(digest);
    routes++;
  }
  await assets.importNativePhotoBatch(batch);
  return { routes, objects: objects.size };
}
