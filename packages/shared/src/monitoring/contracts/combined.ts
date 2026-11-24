import { z } from 'zod';
import { scopeSchema } from './api.js';

export const combinedScopeSchema = scopeSchema.extend({
  source: z.enum(['kakao', 'pokergosu']).optional(),
});
export type CombinedScope = z.infer<typeof combinedScopeSchema>;
