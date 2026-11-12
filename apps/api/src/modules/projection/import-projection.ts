import { monitoringListSchema, projectionDatasetSchema } from '@app/shared';
import type { Conversation, Dataset } from '@app/shared/monitoring/domain/model';
import { z } from 'zod';
import type { MonitoringRepository } from '../monitoring/monitoring.repository.js';
import type { ProjectionRepository } from './projection.repository.js';

const overviewSchema = z.object({
  overview: z.object({
    capturedAt: z.iso.datetime(),
    source: z.enum(['legacy', 'synthetic']),
    collectionState: z.string(),
    gaps: z.number(),
    targets: z.array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()),
        mentions: z.number(),
        aliasCounts: z.record(z.string(), z.number()).optional(),
      }),
    ),
  }),
});
const pageSchema = z.object({
  capturedAt: z.string(),
  items: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export async function importProjection(
  source: Pick<MonitoringRepository, 'read'>,
  target: Pick<ProjectionRepository, 'replace'>,
  datasetSchema = projectionDatasetSchema,
  listSchema = monitoringListSchema,
) {
  const header = overviewSchema.parse(await source.read('/api/overview')).overview;
  const conversations: unknown[] = [],
    cursors = new Set<string>();
  let cursor: string | undefined, total: number | undefined;
  do {
    const input = listSchema.parse({ limit: 50, cursor });
    const page = pageSchema.parse(await source.read('/api/conversations', input));
    if (page.capturedAt !== header.capturedAt || (total !== undefined && total !== page.total))
      throw new Error('Source generation changed during import');
    total = page.total;
    conversations.push(...page.items);
    if (conversations.length > 100000) throw new Error('Import size limit exceeded');
    cursor = page.nextCursor || undefined;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error('Repeated source cursor');
      cursors.add(cursor);
    }
  } while (cursor);
  const end = overviewSchema.parse(await source.read('/api/overview')).overview;
  if (end.capturedAt !== header.capturedAt || conversations.length !== total)
    throw new Error('Source snapshot is incomplete or changed');
  const parsed = datasetSchema.parse({ ...header, conversations });
  const dataset: Dataset = { ...parsed, conversations: parsed.conversations as Conversation[] };
  return target.replace(dataset);
}
