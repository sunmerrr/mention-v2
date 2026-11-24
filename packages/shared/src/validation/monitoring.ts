import { z } from 'zod';

export const monitoringScopeSchema = z.object({
  day: z
    .string()
    .refine((value) => value === '' || z.iso.date().safeParse(value).success)
    .default(''),
  target: z.string().max(100).default(''),
});
export const monitoringListSchema = monitoringScopeSchema.extend({
  mention: z.string().trim().max(200).optional(),
  label: z
    .enum(['', 'positive', 'negative', 'neutral', 'mixed', 'uncertain', 'unreviewed', 'excluded'])
    .default(''),
  status: z.enum(['', 'pending', 'unclassified', 'recheck', 'classified', 'excluded']).default(''),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export const monitoringIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export type MonitoringScope = z.infer<typeof monitoringScopeSchema>;
export type MonitoringList = z.infer<typeof monitoringListSchema>;
