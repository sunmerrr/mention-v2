import { z } from "zod";
import type { ForumEvaluation } from "./forum-opinions";

export const pokergosuId = z.string().regex(/^[1-9][0-9]{0,18}$/);
export const pokergosuListSchema = z.object({
  q: z.string().trim().max(100).default(""),
  keyword: z.string().max(100).default(""),
  day: z
    .string()
    .refine((s) => s === "" || z.iso.date().safeParse(s).success)
    .default(""),
  match: z.enum(["all", "matched"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(1500).optional(),
});
export type PokergosuListInput = z.infer<typeof pokergosuListSchema>;
export interface PokergosuImage {
  key: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  state: "not_cached" | "cached" | "unsupported" | "failed";
  message?: string;
}
export interface PokergosuPost {
  id: string;
  url: string;
  title: string;
  author: string;
  publishedAt: string | null;
  checkedAt: number;
  excerpt: string;
  keywords: string[];
  matched: boolean;
  commentCount: number;
  matchedComments: number;
  imageCount: number;
}
export interface PokergosuSummary {
  available: boolean;
  discovered: number;
  collected: number;
  matched: number;
  pending: number;
  readErrors: number;
  comments: number;
  keywords: string[];
  lastCheckedAt: number | null;
  monitor: null | {
    status: string;
    phase: string;
    reason: string | null;
    nextAt: number | null;
    discoveryGaps: number;
  };
}
export interface PokergosuPage {
  items: PokergosuPost[];
  nextCursor: string | null;
  total: number;
  summary: PokergosuSummary;
}
export interface PokergosuComment {
  images: PokergosuImage[];
  imagesSkipped: number;
  id: string;
  author: string;
  publishedAt: string | null;
  text: string;
  hasMedia: boolean;
  keywords: string[];
}
export interface PokergosuDetail {
  evaluations?: ForumEvaluation[];
  post: PokergosuPost;
  body: string;
  images: PokergosuImage[];
  imagesSkipped: number;
  comments: PokergosuComment[];
  commentsLimited: boolean;
  coverage: string;
  reportedComments: number | null;
  skippedComments: number;
  unavailableComments: number;
}
