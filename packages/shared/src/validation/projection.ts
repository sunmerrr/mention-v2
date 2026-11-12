import { z } from 'zod';

const decision = z.enum(['positive', 'negative', 'neutral', 'mixed', 'uncertain', 'excluded']);
const evaluation = z.object({
  label: z.union([decision, z.literal('unreviewed')]),
  summary: z.string(),
  origin: z.enum(['ai', 'human']).nullable(),
  stale: z.boolean(),
  expected: z.string().optional(),
  previous: z.object({ label: decision, origin: z.enum(['ai', 'human']) }).optional(),
});
const epoch = z
  .number()
  .int()
  .refine((value) => Number.isFinite(new Date(value).getTime()));
export const projectionDatasetSchema = z
  .object({
    source: z.enum(['legacy', 'synthetic']),
    capturedAt: z.iso.datetime(),
    collectionState: z.string(),
    gaps: z.number().int().nonnegative(),
    targets: z.array(
      z.object({
        name: z.string().min(1).max(100),
        aliases: z.array(z.string()),
        mentions: z.number().nonnegative(),
        aliasCounts: z.record(z.string(), z.number()).optional(),
      }),
    ),
    conversations: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            room: z.string(),
            at: epoch,
            title: z.string(),
            targets: z.array(z.string().min(1).max(100)),
            evaluations: z.record(z.string(), evaluation),
            keywords: z.record(z.string(), z.number()),
            messageCount: z.number().int().nonnegative(),
            lastAt: epoch.optional(),
            contextPreview: z
              .array(
                z.object({
                  id: z.string(),
                  author: z.string(),
                  text: z.string(),
                  at: epoch,
                  own: z.boolean().optional(),
                  truncated: z.boolean().optional(),
                }),
              )
              .optional(),
          })
          .passthrough(),
      )
      .max(100000),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const conversation of value.conversations) {
      if (ids.has(conversation.id))
        context.addIssue({ code: 'custom', message: 'Duplicate source conversation identity' });
      ids.add(conversation.id);
    }
  });
