import { z } from 'zod';
import { projectionDatasetSchema } from './projection.js';

const label = z.enum([
  'positive',
  'negative',
  'neutral',
  'mixed',
  'uncertain',
  'excluded',
  'unreviewed',
]);
export const classificationEvidenceSchema = z.object({
  id: z.string().min(1).max(100),
  conversationId: z.string().min(1).max(100),
  target: z.string().min(1).max(100),
  label,
  summary: z.string(),
  origin: z.enum(['ai', 'human']).nullable(),
  stale: z.boolean(),
  expected: z.string().min(1).max(200),
  room: z.string(),
  at: z.number().int(),
  history: z.array(
    z.object({
      at: z.string(),
      origin: z.enum(['ai', 'human']).nullable(),
      before: z.string(),
      after: z.string(),
      note: z.string(),
    }),
  ),
});
export const conversationEvidenceSchema = z.object({
  conversation: projectionDatasetSchema.shape.conversations.element,
  messages: z.array(
    z.object({
      id: z.string().min(1),
      author: z.string(),
      text: z.string(),
      time: z.number().int(),
      phase: z.string(),
      background: z.boolean(),
      backgroundLabel: z.string().optional(),
      own: z.boolean(),
      relation: z.string().optional(),
      anchor: z.boolean().optional(),
      promotionReference: z
        .object({
          logId: z.string(),
          at: z.number(),
          keywords: z.array(z.string()),
          targets: z.array(z.string()),
          method: z.enum(['explicit_reply', 'topic_candidate']),
          ambiguousTargets: z.boolean(),
        })
        .optional(),
      photos: z
        .array(z.object({ url: z.string(), thumbnail: z.string().nullable().optional() }))
        .optional(),
    }),
  ),
  limited: z.boolean(),
  promotionFollowupNeeded: z.boolean().optional(),
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
  source: z.enum(['legacy', 'synthetic']),
  episodes: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
});
export const evidenceBundleSchema = z
  .object({
    detail: conversationEvidenceSchema,
    classifications: z.array(classificationEvidenceSchema),
  })
  .superRefine((v, ctx) => {
    const targets = new Set<string>();
    for (const item of v.classifications) {
      if (
        item.conversationId !== v.detail.conversation.id ||
        !v.detail.conversation.targets.includes(item.target) ||
        targets.has(item.target)
      )
        ctx.addIssue({ code: 'custom', message: 'Evidence identity mismatch' });
      const evaluation = v.detail.conversation.evaluations[item.target];
      if (
        !evaluation ||
        (evaluation.expected !== undefined && evaluation.expected !== item.expected) ||
        evaluation.summary !== item.summary ||
        evaluation.stale !== item.stale ||
        (!evaluation.stale && evaluation.label !== item.label)
      )
        ctx.addIssue({ code: 'custom', message: 'Classification changed during evidence import' });
      targets.add(item.target);
    }
    if (v.detail.conversation.targets.some((t) => !targets.has(t)))
      ctx.addIssue({ code: 'custom', message: 'Missing classification evidence' });
    const ids = new Set<string>();
    for (const message of v.detail.messages) {
      if (ids.has(message.id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate native message identity' });
      ids.add(message.id);
    }
  });
