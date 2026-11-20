import { createHash } from 'node:crypto';
import { z } from 'zod';
import { nativeTime } from '../context/native-message.js';

const nativeId = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => BigInt(value) < 2n ** 63n);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const observed = z.iso.datetime({ offset: true });
export const campaignInput = z.object({
  request_id: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/u),
  room_id: nativeId,
  title: z
    .string()
    .refine((value) => value.trim().length >= 1 && [...value.trim()].length <= 140)
    .max(560),
  seed: z
    .string()
    .refine((value) => value.trim().length >= 1 && [...value.trim()].length <= 2000)
    .max(8000),
  duration: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
});
const sent = z
  .string()
  .regex(/^\d{9,15}(?:\.\d{1,6})?$/u)
  .refine((value) => nativeTime(value) !== null);
const messageSchema = z
  .object({
    chat_id: nativeId,
    log_id: nativeId,
    text: z.string(),
    type: z.literal(1),
    own: z.literal(true),
    observed_at: observed,
    sent_at: sent.nullish(),
    author_id: z.string().max(300).nullish(),
    author_name: z.string().max(300).nullish(),
    reply_to: z.string().max(300).nullish(),
  })
  .passthrough();
const observation = z.strictObject({
  request: campaignInput.strict(),
  fingerprint: digest,
  receipt: z.strictObject({ anchor_ms: z.number().int().positive(), message: messageSchema }),
});
export type CampaignInput = z.infer<typeof campaignInput>;
/** The existing broker signs the ASCII encoding produced by Python json.dumps. */
function asciiJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(asciiJSON).join(', ')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${asciiJSON(key)}: ${asciiJSON(record[key])}`)
      .join(', ')}}`;
  }
  if (typeof value !== 'string') return JSON.stringify(value);
  return [...JSON.stringify(value)]
    .map((character) =>
      (character.codePointAt(0) ?? 0) >= 127
        ? character
            .split('')
            .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
            .join('')
        : character,
    )
    .join('');
}
export const campaignFingerprint = (value: CampaignInput) =>
  sha(asciiJSON([value.room_id, value.title, value.seed, value.duration]));
export const campaignReceiptDigest = (value: unknown) => sha(asciiJSON(value));
export function validatedObservation(value: unknown, now = Date.now()) {
  const input = observation.parse(value);
  const { request, receipt, fingerprint } = input;
  const { message, anchor_ms } = receipt;
  const observedAt = Date.parse(message.observed_at);
  if (
    fingerprint !== campaignFingerprint(request) ||
    anchor_ms > now + 60_000 ||
    anchor_ms > observedAt + 60_000 ||
    message.chat_id !== request.room_id ||
    message.text !== request.seed ||
    (nativeTime(message.sent_at) ?? observedAt) !== anchor_ms
  )
    throw Error('INVALID_CONFIRMED_OBSERVATION');
  return { request, receipt, fingerprint, receiptHash: campaignReceiptDigest(receipt) };
}
