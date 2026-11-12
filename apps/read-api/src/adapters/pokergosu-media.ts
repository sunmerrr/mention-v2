import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PokergosuMedia } from "../../../../packages/application/src/pokergosu";
import type { PokergosuImage } from "../../../../packages/contracts/src/pokergosu";
import { supportedPokergosuImage } from "../../../../packages/domain/src/pokergosu-media";

const LIMIT = 8 * 1024 * 1024;
export function rasterType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString()))
    return "image/gif";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (
    b.subarray(4, 8).toString() === "ftyp" &&
    ["avif", "avis"].includes(b.subarray(8, 12).toString())
  )
    return "image/avif";
  return null;
}
type Receipt = {
  state: "cached" | "failed";
  mime?: string;
  at: number;
  code?: string;
};
/** No automatic source requests: downloads happen only on an explicit viewer POST. */
export class PokergosuMediaCache implements PokergosuMedia {
  private flight?: { key: string; promise: Promise<PokergosuImage> };
  constructor(
    private readonly directory: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  private receipt(key: string): Receipt | null {
    if (!/^[a-f0-9]{64}$/.test(key)) return null;
    try {
      return JSON.parse(
        readFileSync(path.join(this.directory, `${key}.json`), "utf8"),
      );
    } catch {
      return null;
    }
  }
  describe(image: PokergosuImage): PokergosuImage {
    const receipt = this.receipt(image.key);
    if (
      receipt?.state === "cached" &&
      existsSync(path.join(this.directory, `${image.key}.bin`))
    )
      return { ...image, state: "cached" };
    if (receipt?.state === "failed")
      return {
        ...image,
        state: "failed",
        message: "이미지를 받지 못했습니다. 자동으로 재시도하지 않습니다.",
      };
    return image;
  }
  async load(image: PokergosuImage): Promise<PokergosuImage> {
    if (
      !/^[a-f0-9]{64}$/.test(image.key) ||
      createHash("sha256").update(image.url).digest("hex") !== image.key ||
      !supportedPokergosuImage(image.url)
    )
      return {
        ...image,
        state: "unsupported",
        message:
          "외부 이미지 호스트는 자동으로 요청하지 않습니다. 원문에서 확인해 주세요.",
      };
    const current = this.describe(image);
    if (current.state === "cached" || current.state === "failed")
      return current;
    if (this.flight) {
      if (this.flight.key === image.key) return this.flight.promise;
      return {
        ...image,
        state: "not_cached",
        message: "다른 이미지를 받는 중입니다. 잠시 후 눌러주세요.",
      };
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (existsSync(path.join(this.directory, "access-hold.json")))
      return {
        ...image,
        state: "failed",
        message: "이미지 접근 제한 기록이 있어 다운로드를 중지했습니다.",
      };
    const promise = this.download(image);
    this.flight = { key: image.key, promise };
    try {
      return await promise;
    } finally {
      this.flight = undefined;
    }
  }
  private save(key: string, receipt: Receipt) {
    writeFileSync(
      path.join(this.directory, `${key}.json`),
      JSON.stringify(receipt),
      { mode: 0o600 },
    );
  }
  private async download(image: PokergosuImage): Promise<PokergosuImage> {
    let url = image.url;
    try {
      let response: Response | undefined;
      const signal = AbortSignal.timeout(15000);
      for (let hop = 0; hop < 4; hop++) {
        if (!supportedPokergosuImage(url))
          throw new Error("UNSUPPORTED_REDIRECT");
        response = await this.request(url, {
          redirect: "manual",
          credentials: "omit",
          signal,
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw new Error("INVALID_REDIRECT");
          url = new URL(location, url).href;
          continue;
        }
        break;
      }
      if (response?.status !== 200) {
        if (response && [403, 429].includes(response.status))
          writeFileSync(
            path.join(this.directory, "access-hold.json"),
            JSON.stringify({
              at: Date.now(),
              status: response.status,
              kind: "image-access-restriction",
              accountBanConfirmed: false,
            }),
            { mode: 0o600 },
          );
        await response?.body?.cancel();
        throw new Error(`HTTP_${response?.status || 0}`);
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("image/")
      ) {
        await response.body?.cancel();
        throw new Error("NOT_IMAGE");
      }
      if (Number(response.headers.get("content-length")) > LIMIT) {
        await response.body?.cancel();
        throw new Error("IMAGE_TOO_LARGE");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("EMPTY_IMAGE");
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > LIMIT) {
          await reader.cancel();
          throw new Error("IMAGE_TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
      const bytes = Buffer.concat(chunks),
        mime = rasterType(bytes);
      if (!mime) throw new Error("UNSUPPORTED_IMAGE_FORMAT");
      const temp = path.join(this.directory, `${image.key}.tmp`);
      writeFileSync(temp, bytes, { mode: 0o600 });
      renameSync(temp, path.join(this.directory, `${image.key}.bin`));
      this.save(image.key, { state: "cached", mime, at: Date.now() });
      return { ...image, state: "cached" };
    } catch (error) {
      this.save(image.key, {
        state: "failed",
        at: Date.now(),
        code: error instanceof Error ? error.message.slice(0, 80) : "FAILED",
      });
      return {
        ...image,
        state: "failed",
        message: "이미지를 받지 못했습니다. 자동으로 재시도하지 않습니다.",
      };
    }
  }
  async file(key: string) {
    const r = this.receipt(key);
    if (
      r?.state !== "cached" ||
      !r.mime ||
      ![
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
      ].includes(r.mime)
    )
      return null;
    try {
      return {
        bytes: await readFile(path.join(this.directory, `${key}.bin`)),
        mime: r.mime,
      };
    } catch {
      return null;
    }
  }
}
