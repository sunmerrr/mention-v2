import { z } from "zod";
import type { Classification } from "./api";
export interface ForumEvaluation extends Classification {
  targetId: string;
}
export const forumCorrectionSchema = z.object({
  id: z.string().regex(/^[1-9][0-9]{0,18}$/),
  service: z.string().min(1).max(80),
  verdict: z.enum([
    "positive",
    "negative",
    "mixed",
    "neutral",
    "uncertain",
    "excluded",
  ]),
  summary: z.string().max(2800),
  expected: z.string().regex(/^[a-f0-9]{64}$/),
  request_id: z.string().uuid(),
  origin: z.enum(["human", "ai"]).default("human"),
});
export type ForumCorrection = z.infer<typeof forumCorrectionSchema>;
