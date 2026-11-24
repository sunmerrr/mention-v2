import { z } from 'zod';
import { classificationEvidenceSchema } from '../../validation/evidence';
import type { ForumEvaluation } from './forum-opinions';

export const pokergosuId = z.string().regex(/^[1-9][0-9]{0,18}$/);
export const pokergosuListSchema = z.object({
  mention: z.string().trim().max(200).optional(),
  target: z.string().max(100).optional(),
  q: z.string().trim().max(100).default(''),
  keyword: z.string().max(100).default(''),
  day: z
    .string()
    .refine((s) => s === '' || z.iso.date().safeParse(s).success)
    .default(''),
  match: z.enum(['all', 'matched']).default('all'),
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
  state: 'not_cached' | 'cached' | 'unsupported' | 'failed';
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

const imageSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  url: z.string(),
  alt: z.string(),
  width: z.number(),
  height: z.number(),
  state: z.enum(['not_cached', 'cached', 'unsupported', 'failed']),
  message: z.string().optional(),
});
export const pokergosuPostSchema = z.object({
  id: pokergosuId,
  url: z.string(),
  title: z.string(),
  author: z.string(),
  publishedAt: z.string().nullable(),
  checkedAt: z.number().finite().min(0).max(8640000000000000),
  excerpt: z.string(),
  keywords: z.array(z.string()),
  matched: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  matchedComments: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
});
export const pokergosuSummarySchema = z.object({
  available: z.boolean(),
  discovered: z.number().int().nonnegative(),
  collected: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  readErrors: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  keywords: z.array(z.string()),
  lastCheckedAt: z.number().nullable(),
  monitor: z
    .object({
      status: z.string(),
      phase: z.string(),
      reason: z.string().nullable(),
      nextAt: z.number().nullable(),
      discoveryGaps: z.number(),
    })
    .nullable(),
});

export const pokergosuDetailSchema = z.object({
  post: pokergosuPostSchema,
  body: z.string(),
  images: z.array(imageSchema),
  imagesSkipped: z.number().int().nonnegative(),
  comments: z.array(
    z.object({
      id: z.string(),
      images: z.array(imageSchema),
      imagesSkipped: z.number().int().nonnegative(),
      author: z.string(),
      publishedAt: z.string().nullable(),
      text: z.string(),
      hasMedia: z.boolean(),
      keywords: z.array(z.string()),
    }),
  ),
  commentsLimited: z.boolean(),
  coverage: z.string(),
  reportedComments: z.number().nullable(),
  skippedComments: z.number().int().nonnegative(),
  unavailableComments: z.number().int().nonnegative(),
  evaluations: z
    .array(
      classificationEvidenceSchema.extend({ targetId: z.string().min(1), at: z.number().finite() }),
    )
    .optional(),
});
