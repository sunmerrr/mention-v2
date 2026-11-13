import { z } from 'zod';

/** Flat HTTPS receiver protocol. The configured base path is deployment-owned. */
export const POKERGOSU_RECEIVER_PROTOCOL_VERSION = 1;
export const POKERGOSU_RECEIVER_BASE_PATH = '/collector/pokergosu/v1';
export const pokergosuReceiverPaths = {
  status: '/status',
  plan: '/plan',
  capture: '/capture',
  searchPlan: '/search/plan',
  controlPoll: '/control/poll',
  controlAck: '/control/ack',
} as const;
export const POKERGOSU_CAPTURE_MAX_BYTES = 2 * 1024 * 1024;
const id = z.string().regex(/^[1-9][0-9]{0,18}$/);
const count = z.number().int().nonnegative();
const timestamp = z.string().max(100).nullable().optional();
const httpsReference = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.hash;
    } catch {
      return false;
    }
  }, 'HTTPS image reference required');
const postUrl = z.string().regex(/^https:\/\/www\.pokergosu\.com\/free\/[1-9][0-9]{0,18}$/);
const metadata = {
  author: z.string().max(500).default(''),
  published_at: timestamp,
  metadata_text: z.string().max(1000).default(''),
};
const image = z.object({
  url: httpsReference,
  alt: z.string().max(500).default(''),
  width: z.number().finite().min(0).max(100000).default(0),
  height: z.number().finite().min(0).max(100000).default(0),
});
const media = {
  images: z.array(image).max(100).default([]),
  images_skipped: count.max(100000).default(0),
};
const comment = z
  .object({
    id,
    text: z.string().max(200000),
    ...metadata,
    ...media,
    parent_id: id.nullable().optional(),
    has_media: z.boolean().default(false),
    content_kind: z.enum(['text', 'mixed', 'media_only']).default('text'),
  })
  .superRefine((value, ctx) => {
    const valid =
      value.content_kind === 'media_only'
        ? !value.text && value.has_media
        : value.content_kind === 'mixed'
          ? !!value.text && value.has_media
          : !!value.text && !value.has_media;
    if (!valid)
      ctx.addIssue({
        code: 'custom',
        message: 'Comment media/text evidence is inconsistent',
      });
  });
export const pokergosuRawThreadSchema = z
  .object({
    id,
    url: postUrl,
    title: z.string().max(2000),
    body: z.string().max(200000),
    ...metadata,
    ...media,
    comments: z.array(comment).max(3000),
    comment_coverage: z.enum(['visible-complete', 'partial', 'unknown']),
    expected_comments: count.max(100000).nullable(),
    reported_comments: count.max(100000).nullable().optional(),
    unavailable_comments: count.max(100000).nullable().default(0),
    skipped_comments: z
      .array(
        z.object({
          id: id.nullable(),
          reason: z.enum(['MISSING_OR_INVALID_ID', 'CONTENT_NOT_FOUND', 'EMPTY_OR_UNREADABLE']),
        }),
      )
      .max(3000)
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.url !== `https://www.pokergosu.com/free/${value.id}`)
      ctx.addIssue({ code: 'custom', message: 'Thread ID and URL differ' });
    const ids = value.comments
      .map((c) => c.id)
      .concat(value.skipped_comments.flatMap((c) => (c.id ? [c.id] : [])));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate comment ID' });
    if (value.images.length + value.comments.reduce((n, c) => n + c.images.length, 0) > 100)
      ctx.addIssue({ code: 'custom', message: 'Too many image references' });
    if (value.comment_coverage === 'unknown') {
      if (value.expected_comments !== null || value.unavailable_comments !== null)
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown coverage requires explicit unknown counts',
        });
    } else {
      if (
        value.unavailable_comments === null ||
        value.expected_comments !==
          value.comments.length + value.skipped_comments.length + (value.unavailable_comments ?? 0)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Comment coverage counts differ',
        });
      if (
        value.comment_coverage === 'visible-complete' &&
        (value.skipped_comments.length || value.unavailable_comments !== 0)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Complete coverage cannot hide omitted comments',
        });
    }
  });
export const pokergosuReceiverStatusSchema = z
  .object({
    protocolVersion: z.literal(POKERGOSU_RECEIVER_PROTOCOL_VERSION).optional(),
    collectorId: z.string().min(1).max(128).optional(),
    threads: count,
    matched: count,
  })
  .passthrough()
  .refine((value) => value.matched <= value.threads, 'Matched count exceeds stored threads');
export const pokergosuReceiverPlanSchema = z
  .object({
    queue: z.array(z.object({ id, url: postUrl })).max(6),
    pending_threads: count,
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (
      new Set(value.queue.map((p) => p.id)).size !== value.queue.length ||
      value.queue.some((p) => p.url !== `https://www.pokergosu.com/free/${p.id}`)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid or repeated queue identity',
      });
  });
const discovery = z
  .object({ id, url: postUrl, pinned: z.boolean().optional() })
  .refine(
    (value) => value.url === `https://www.pokergosu.com/free/${value.id}`,
    'Invalid discovery identity',
  );
const sourceListUrl = z
  .string()
  .max(600)
  .refine((value) => {
    try {
      const u = new URL(value);
      if (u.origin !== 'https://www.pokergosu.com' || u.username || u.password || u.hash)
        return false;
      if (u.pathname === '/free') return !u.search;
      if (u.pathname !== '/free/search') return false;
      const keys = [...u.searchParams.keys()];
      if (
        keys.length !== 2 ||
        !keys.includes('s') ||
        !keys.includes('v') ||
        !['1', '4'].includes(u.searchParams.get('s') || '')
      )
        return false;
      const term = decodeURIComponent(u.searchParams.get('v') || '');
      return (
        [...term].length >= 2 &&
        [...term].length <= 20 &&
        term === term.trim() &&
        ![...term].some((c) => (c.codePointAt(0) ?? 0) < 32)
      );
    } catch {
      return false;
    }
  }, 'Invalid source list URL');
/** Raw content only. Monitor/trial/control snapshots require their own validated state machines. */
export const pokergosuContentCaptureSchema = z
  .discriminatedUnion('operation', [
    z.object({
      operation: z.literal('thread'),
      eventId: z.uuid().optional(),
      capturedAt: z.iso.datetime().optional(),
      page_url: postUrl,
      data: pokergosuRawThreadSchema,
    }),
    z.object({
      operation: z.literal('list'),
      eventId: z.uuid().optional(),
      capturedAt: z.iso.datetime().optional(),
      page_url: sourceListUrl,
      data: z.array(discovery).max(300),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.operation === 'thread' && value.page_url !== value.data.url)
      ctx.addIssue({
        code: 'custom',
        message: 'Capture page differs from payload',
      });
    if (
      value.operation === 'list' &&
      value.page_url === 'https://www.pokergosu.com/free' &&
      !value.data.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Empty ordinary list is not evidence of an empty board',
      });
  });
export type PokergosuRawThread = z.infer<typeof pokergosuRawThreadSchema>;
export type PokergosuContentCapture = z.infer<typeof pokergosuContentCaptureSchema>;

/** Durable raw acceptance does not imply that matching or classification completed. */
export const pokergosuThreadCaptureAckSchema = z
  .object({
    saved: z.literal(true),
    accepted: z.literal(true).optional(),
    receiptId: z.string().min(1).max(128).optional(),
    receivedAt: z.iso.datetime().optional(),
    matchStatus: z.enum(['pending', 'complete']).optional(),
    eligible: z.boolean().optional(),
    matched_comments: count.max(3000).optional(),
    comments: count.max(3000),
    metadata_missing: z.boolean().optional(),
    comment_summary: z.object({
      saved: count.max(3000),
      media_only: count.max(3000),
      skipped: count.max(3000),
      unavailable: count.max(100000).nullable(),
      coverage: z.enum(['visible-complete', 'partial', 'unknown']),
    }),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (
      value.matchStatus === 'pending' &&
      (value.eligible !== undefined || value.matched_comments !== undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Pending matching cannot claim eligibility',
      });
    if (
      value.comments !== value.comment_summary.saved ||
      value.comment_summary.media_only > value.comments
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Acknowledgement comment counts differ',
      });
  });
