import { z } from 'zod';

export const topicScopeSchema = z.object({
  mode: z.enum(['recent', 'daily']).default('recent'),
  day: z.union([z.literal(''), z.iso.date()]).default(''),
});
export type TopicScope = z.infer<typeof topicScopeSchema>;
