import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyReader } from "../apps/read-api/src/adapters/legacy";

const id = "0".repeat(32);
const group = {
  id,
  room: "합성 방",
  anchor_ms: 1793850000000,
  members: [{ title: "합성 발언" }],
  services: ["샘플"],
  evaluations: {
    샘플: {
      verdict: "neutral",
      summary: "[AI 확정] 합성 근거",
      source: "conversation_review",
      needs_review: false,
    },
  },
  keyword_counts: { 샘플: 1 },
  message_count: 1,
};
function snapshot() {
  return {
    conversations: [group],
    keyword_groups: [{ name: "샘플", keywords: ["샘플"], message_count: 1 }],
    status: "monitoring",
  };
}
afterEach(() => vi.restoreAllMocks());
describe("legacy public read adapter", () => {
  it("coalesces the initial source read and always uses public scope", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(snapshot())));
    const reader = new LegacyReader("http://127.0.0.1:8766");
    const [a, b] = await Promise.all([reader.read(), reader.read()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      "X-Monitor-Public": "1",
    });
    expect(a.conversations[0].evaluations.샘플.origin).toBe("ai");
    expect(a.conversations[0].evaluations.샘플.summary).toBe("합성 근거");
  });
  it("normalizes SQLite numeric boolean values without leaking transport types", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ...group,
          messages: [
            {
              log_id: "1",
              text: "합성 맥락",
              author_name: "테스트",
              time_ms: 1793850000000,
              own: 0,
              promotion_reference: {
                log_id: "123",
                time_ms: 1793849990000,
                keywords: ["샘플"],
                targets: ["샘플"],
                method: "topic_candidate",
                ambiguous_targets: false,
              },
            },
          ],
          context_summary: { limited: true, promotion_followup_needed: true },
          phase_counts: { before: 0, after: 0 },
        }),
      ),
    );
    const detail = await new LegacyReader("http://127.0.0.1:8766").detail(id);
    expect(detail.messages[0].own).toBe(false);
    expect(detail.messages[0].text).toBe("합성 맥락");
    expect(detail.messages[0].promotionReference).toEqual({
      logId: "123",
      at: 1793849990000,
      keywords: ["샘플"],
      targets: ["샘플"],
      method: "topic_candidate",
      ambiguousTargets: false,
    });
    expect(detail.limited).toBe(true);
    expect(detail.promotionFollowupNeeded).toBe(true);
  });
  it("does not accept external hosts or arbitrary conversation paths", async () => {
    expect(() => new LegacyReader("https://example.com")).toThrow();
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      new LegacyReader("http://127.0.0.1:8766").detail("../assistant"),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
