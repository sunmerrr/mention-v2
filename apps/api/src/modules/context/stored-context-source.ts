import { and, asc, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { kakaoMessages } from '../../db/schema.js';
import type { EvidenceRepository } from '../evidence/evidence.repository.js';
import { nativeId } from './native-message.js';
import type { ContextMessage, ContextPage, ContextSource } from './useful-context.js';

/** Reads only retained evidence. Stored boundaries never claim that native history is exhausted. */
export class StoredContextSource implements ContextSource {
  constructor(
    private readonly database: Pick<EvidenceRepository['db'], 'select'>,
    private readonly input: {
      roomId: string;
      anchorId: string;
      direction: 'before' | 'after';
      from: number;
      until: number;
      relations?: ReadonlyMap<string, NonNullable<ContextMessage['relation']>>;
    },
  ) {
    if (
      !nativeId(input.roomId) ||
      !nativeId(input.anchorId) ||
      !Number.isSafeInteger(input.from) ||
      !Number.isSafeInteger(input.until) ||
      input.from < 0 ||
      input.until < input.from
    )
      throw Error('INVALID_STORED_CONTEXT_SCOPE');
  }
  async read(cursor: string | null, limit: number): Promise<ContextPage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error('INVALID_STORED_CONTEXT_LIMIT');
    const boundary = cursor ?? this.input.anchorId;
    if (
      !nativeId(boundary) ||
      (this.input.direction === 'before'
        ? BigInt(boundary) > BigInt(this.input.anchorId)
        : BigInt(boundary) < BigInt(this.input.anchorId))
    )
      throw Error('INVALID_STORED_CONTEXT_CURSOR');
    const before = this.input.direction === 'before';
    const time = sql<number>`((${kakaoMessages.body}->>'sortAt')::bigint)`;
    const rows = await this.database
      .select({ body: kakaoMessages.body })
      .from(kakaoMessages)
      .where(
        and(
          eq(kakaoMessages.roomId, this.input.roomId),
          before ? lt(kakaoMessages.orderId, boundary) : gt(kakaoMessages.orderId, boundary),
          gte(time, this.input.from),
          lte(time, this.input.until),
        ),
      )
      .orderBy(before ? desc(kakaoMessages.orderId) : asc(kakaoMessages.orderId))
      .limit(limit + 1);
    const selected = rows.slice(0, limit).map(
      ({ body }): ContextMessage => ({
        roomId: body.roomId,
        logId: body.logId,
        authorId: body.authorId ?? undefined,
        authorName: body.authorName,
        text: body.text,
        type: body.type,
        own: body.own,
        sortAt: body.sortAt,
        replyTo: body.replyTo,
        relation: this.input.relations?.get(body.logId),
      }),
    );
    return {
      messages: selected,
      cursor: selected.at(-1)?.logId ?? cursor,
      exhausted: false,
      ...(rows.length <= limit ? { gap: 'stored_history_boundary' } : {}),
    };
  }
}
