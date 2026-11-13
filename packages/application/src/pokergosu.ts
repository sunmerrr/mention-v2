import type { ForumEvaluation } from "../../contracts/src/forum-opinions";
import type {
  PokergosuDetail,
  PokergosuImage,
  PokergosuListInput,
  PokergosuPage,
  PokergosuSummary,
} from "../../contracts/src/pokergosu";
import { InvalidCursor } from "./queries";

export class PokergosuPostNotFound extends Error {
  readonly statusCode = 404;
}
export interface PokergosuCursor {
  last: string;
  ceiling: string;
  scope: string;
}
export interface PokergosuReader {
  summary(): Promise<PokergosuSummary>;
  list(
    input: PokergosuListInput,
    cursor?: PokergosuCursor,
  ): Promise<PokergosuPage>;
  detail(id: string): Promise<PokergosuDetail | null>;
}
export function pokergosuScope(input: PokergosuListInput) {
  return JSON.stringify([input.q, input.keyword, input.day, input.match]);
}
export function encodePokergosuCursor(cursor: PokergosuCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export interface PokergosuMedia {
  describe(image: PokergosuImage): PokergosuImage;
  load(image: PokergosuImage): Promise<PokergosuImage>;
  file(key: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}
export class PokergosuQueries {
  constructor(
    private readonly reader: PokergosuReader,
    private readonly media?: PokergosuMedia,
    private readonly opinions?: {
      options(detail: PokergosuDetail): Promise<ForumEvaluation[]>;
    },
  ) {}
  summary() {
    return this.reader.summary();
  }
  async list(input: PokergosuListInput) {
    let cursor: PokergosuCursor | undefined;
    if (input.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (
          !cursor ||
          typeof cursor.last !== "string" ||
          typeof cursor.ceiling !== "string" ||
          cursor.scope !== pokergosuScope(input) ||
          !/^[1-9][0-9]{0,18}$/.test(cursor.last) ||
          !/^[1-9][0-9]{0,18}$/.test(cursor.ceiling)
        )
          throw new Error();
      } catch {
        throw new InvalidCursor(
          "필터가 변경됐거나 페이지 정보가 올바르지 않습니다. 처음부터 조회해 주세요.",
        );
      }
    }
    return this.reader.list(input, cursor);
  }
  async detail(id: string) {
    const value = await this.reader.detail(id);
    const media = this.media;
    if (value && media) {
      value.images = value.images.map((i) => media.describe(i));
      for (const comment of value.comments)
        comment.images = comment.images.map((i) => media.describe(i));
    }
    if (value && this.opinions)
      value.evaluations = await this.opinions.options(value);
    return value;
  }
  async loadMedia(id: string, key: string) {
    const value = await this.detail(id);
    const image =
      value &&
      [...value.images, ...value.comments.flatMap((c) => c.images)].find(
        (i) => i.key === key,
      );
    if (!image || !this.media)
      throw new PokergosuPostNotFound("Image not found");
    return this.media.load(image);
  }
  cachedMedia(key: string) {
    return this.media?.file(key) ?? Promise.resolve(null);
  }
}
