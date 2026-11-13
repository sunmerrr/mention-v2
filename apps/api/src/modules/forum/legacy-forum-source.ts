import { pokergosuRawThreadSchema } from '@app/shared';
import { z } from 'zod';
/** Strictly validate old source payloads before making them available to Node reindexing. */
export function legacyForumSource(row: Record<string, unknown>) {
  if (row.payload === null || row.payload === undefined) return null;
  const source = z
    .object({ id: z.string(), payload: z.string(), checked_at: z.number().finite().nonnegative() })
    .parse(row);
  const raw = pokergosuRawThreadSchema.parse(JSON.parse(source.payload));
  if (raw.id !== source.id) throw Error('FORUM_SOURCE_ID_MISMATCH');
  return { raw, checkedAt: source.checked_at * 1000 };
}
