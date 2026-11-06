import { z } from "zod";
import type {
  Conversation,
  Label,
  Origin,
  Overview,
  Scope,
} from "../../domain/src/model";
export const scopeSchema = z.object({
  day: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .default(""),
  target: z.string().max(100).default(""),
});
export const listSchema = scopeSchema.extend({
  label: z
    .enum([
      "",
      "positive",
      "negative",
      "neutral",
      "mixed",
      "uncertain",
      "unreviewed",
    ])
    .default(""),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
export type ListInput = z.infer<typeof listSchema>;
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
  capturedAt: string;
  source: "legacy" | "synthetic";
}
export interface Message {
  id: string;
  author: string;
  text: string;
  time: number;
  phase: string;
  background: boolean;
  own: boolean;
}
export interface Detail {
  conversation: Conversation;
  messages: Message[];
  limited: boolean;
  before: number;
  after: number;
  source: "legacy" | "synthetic";
}
export interface Classification {
  id: string;
  conversationId: string;
  target: string;
  label: Label;
  summary: string;
  origin: Origin;
  stale: boolean;
  expected: string;
  room: string;
  at: number;
  history: {
    at: string;
    origin: Origin;
    before: string;
    after: string;
    note: string;
  }[];
}
export const correctionSchema = z.object({
  id: z.string().min(1).max(100),
  service: z.string().min(1).max(100),
  verdict: z.enum(["positive", "negative", "neutral", "mixed", "uncertain"]),
  summary: z.string().max(2800),
  expected: z.string().min(1).max(200),
  request_id: z.string().uuid(),
});
export type Correction = z.infer<typeof correctionSchema>;
export interface Metadata {
  targets: { name: string; aliases: string[] }[];
  days: string[];
  source: "legacy" | "synthetic";
}
export interface OverviewPayload {
  overview: Overview;
  metadata: Metadata;
}
export type { Scope };
