import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Synthetic public-board DB only; no collector runtime or messages are read. */
export function pokergosuFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "mention-pg-view-")),
    filename = path.join(root, "monitor.sqlite3");
  const db = new DatabaseSync(filename);
  db.exec(
    "CREATE TABLE threads(id TEXT PRIMARY KEY,url TEXT,discovered_at REAL,checked_at REAL,payload TEXT,eligible INTEGER); CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT);",
  );
  const at = Date.parse("2026-11-12T12:00:00+09:00") / 1000;
  function insert(id: string, i = Number(id)) {
    const terms = i % 2 === 0 ? ["APL"] : [],
      commentTerms = i === 25 ? ["룰루"] : [];
    const payload = {
      id,
      url: `https://www.pokergosu.com/free/${id}`,
      title: `합성 포커고수 게시글 ${i}`,
      body: `합성 본문 ${i}\n두 번째 줄`,
      author: "합성 작성자",
      published_at: "2026-11-12 11:50:00",
      match: { included: terms, eligible: !!terms.length },
      eligible: !!terms.length || !!commentTerms.length,
      images:
        i === 25
          ? [
              {
                url: "https://www.ipokergosu.com/uploads/synthetic.png",
                alt: "합성 본문 사진",
                width: 1,
                height: 1,
              },
            ]
          : [],
      images_skipped: 0,
      comments: [
        {
          id: `${id}1`,
          author: "합성 댓글 작성자",
          published_at: null,
          text: i === 25 ? "룰루에 대한 댓글만 일치" : "합성 댓글",
          has_media: false,
          content_kind: "text",
          match: { included: commentTerms, eligible: !!commentTerms.length },
        },
        {
          id: `${id}2`,
          text: "",
          author: "",
          published_at: null,
          has_media: true,
          content_kind: "media_only",
          match: { included: [], eligible: false },
        },
      ],
      comment_coverage: "partial",
      reported_comments: 3,
      skipped_comments: [{ reason: "empty" }],
      unavailable_comments: 0,
    };
    db.prepare("INSERT OR REPLACE INTO threads VALUES (?,?,?,?,?,?)").run(
      id,
      payload.url,
      at,
      at,
      JSON.stringify(payload),
      Number(payload.eligible),
    );
  }
  for (let i = 1; i <= 25; i++) insert(String(i));
  for (const id of ["26", "27"])
    db.prepare("INSERT INTO threads VALUES (?,?,?,NULL,NULL,0)").run(
      id,
      `https://www.pokergosu.com/free/${id}`,
      at,
    );
  db.prepare("INSERT INTO state VALUES (?,?)").run(
    "extension_monitor",
    JSON.stringify({
      status: "running",
      phase: "rest",
      reason: null,
      nextAt: at * 1000 + 900000,
      discoveryGaps: 1,
    }),
  );
  // A credential-like sentinel must never enter DTOs, SSR or public responses.
  db.prepare("INSERT INTO state VALUES (?,?)").run(
    "private_sentinel",
    JSON.stringify({ token: "SYNTHETIC_PRIVATE_DO_NOT_EXPOSE" }),
  );
  return {
    db,
    filename,
    insert,
    close: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
