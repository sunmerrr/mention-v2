import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { extract } from "../tools/pokergosu/browser.mjs";

const browser = await chromium.launch({
  executablePath:
    process.env.MENTION_CHROME ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
let checks = 0;
try {
  const page = await browser.newPage();
  let markup = "";
  await page.route("**/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body:
        route.request().isNavigationRequest() &&
        route.request().frame() === page.mainFrame()
          ? markup
          : "",
    }),
  );
  async function load(html, path = "/free/123") {
    markup = html;
    await page.goto(`https://www.pokergosu.com${path}`, {
      waitUntil: "domcontentloaded",
    });
  }
  await load(
    '<h1>자유 게시판</h1><main><ul><li><a href="/free/123">subject</a><a href="/free/123#comment">[9]</a></li><li class="notice"><a href="/free/999">notice</a></li></ul></main><aside><li><a href="/free/888">popular</a></li></aside>',
    "/free",
  );
  let value = await extract(page, "list");
  assert.deepEqual(
    value.data.map((p) => [p.id, p.pinned]),
    [
      ["123", false],
      ["999", true],
    ],
  );
  checks++;
  const post =
    '<h1>subject</h1><article><div class="post-content">ordinary body<script>APL hidden script</script></div></article>';
  await load(
    `${post}<span data-comment-count="2">댓글 수 2</span><ul><li id="comment_1"><span class="author">one</span><div class="comment-content">APL 후기</div><ul><li id="comment_2"><span class="author">two</span><div class="comment-content">룰루 후기</div></li></ul></li></ul>`,
  );
  value = await extract(page, "thread");
  assert.equal(value.data.body, "ordinary body");
  checks++;
  assert.equal(value.data.comments.length, 2);
  checks++;
  assert.equal(value.data.comments[0].text, "APL 후기");
  checks++;
  assert.equal(value.data.comments[1].parent_id, "1");
  checks++;
  await load(`${post}<span data-comment-count="0">댓글 수 0</span>`);
  assert.equal((await extract(page, "thread")).data.comments.length, 0);
  checks++;
  await load(`${post}<span data-comment-count="12">댓글 수 12</span>`);
  assert.equal(
    (await extract(page, "thread")).data.comment_coverage,
    "partial",
  );
  checks++;
  await load(post);
  assert.equal(
    (await extract(page, "thread")).data.comment_coverage,
    "unknown",
  );
  checks++;
  await load("<h1>changed markup</h1>");
  assert.equal((await extract(page, "thread")).paused, "THREAD_MARKUP_UNKNOWN");
  checks++;
  await load(
    "<title>Just a moment...</title><h1>Just a moment...</h1>",
    "/free",
  );
  assert.equal((await extract(page, "list")).paused, "BOT_CHALLENGE");
  checks++;
  // Synthetic reconstruction of observed structural selectors, never real text.
  await load(
    '<div class="col-main"><article><div class="boarddocument"><h1>synthetic topic</h1><div class="ugc-box">synthetic body · 댓글 999</div><div id="comment">댓글 수 2</div><div class="comments"><div class="comment" id="C101"><div class="cboard">APL synthetic comment</div><div class="child-comments"><div class="comment" id="C102"><div class="cboard">synthetic reply</div></div></div></div></div></div></article></div>',
  );
  value = await extract(page, "thread");
  assert.equal(value.data.body, "synthetic body · 댓글 999");
  checks++;
  assert.deepEqual(
    value.data.comments.map((c) => [c.id, c.text]),
    [
      ["101", "APL synthetic comment"],
      ["102", "synthetic reply"],
    ],
  );
  checks++;
  assert.equal(value.data.comments[1].parent_id, "101");
  checks++;
  assert.equal(value.data.expected_comments, 2);
  checks++;
  await load(
    '<article><div class="boarddocument"><h1>synthetic media</h1><div class="ugc-box"><img alt="" src="/synthetic.png"></div><div id="comment">댓글 수 0</div><div class="comments"></div></div></article>',
  );
  assert.equal((await extract(page, "thread")).data.body, "");
  checks++;
  await load(
    '<div class="col-main"><h1>자유 게시판</h1><article><table><tbody><tr><td><a href="/free/123">synthetic topic</a></td></tr></tbody></table></article></div>',
    "/free",
  );
  assert.equal((await extract(page, "list")).data.length, 1);
  checks++;
  await load(
    '<h1>자유 게시판</h1><div class="col-main"><table><tr><td><span>공지</span><a href="/free/1">synthetic notice</a></td></tr><tr><td><a href="/free/123">synthetic topic</a></td></tr></table></div>',
    "/free",
  );
  assert.equal((await extract(page, "list")).data[0].pinned, true);
  checks++;
  await load(
    '<article><div class="boarddocument"><h1>synthetic topic</h1><div>synthetic writer 2026.11.11 10:20:30</div><div class="ugc-box">body must not leak into metadata</div><div id="comment">댓글 수 1</div><div class="comments"><div class="comment" id="C101"><div>synthetic commenter 2026.11.11 10:21:00</div><div class="cboard">comment must not leak into metadata</div><textarea>synthetic private draft</textarea></div></div><div id="editorbox" contenteditable="true">another synthetic draft</div></div></article>',
  );
  value = await extract(page, "thread");
  assert.ok(
    value.data.metadata_text.includes("synthetic writer 2026.11.11 10:20:30"),
  );
  checks++;
  assert.ok(
    value.data.comments[0].metadata_text.includes(
      "synthetic commenter 2026.11.11 10:21:00",
    ),
  );
  checks++;
  assert.ok(
    !JSON.stringify([
      value.data.metadata_text,
      value.data.comments[0].metadata_text,
    ]).match(/must not leak|private draft|another synthetic draft/),
  );
  checks++;
  await load(
    '<title>Just a moment...</title><div id="challenge-stage">Verify you are human</div>',
  );
  value = await extract(page, "thread");
  assert.equal(value.access.kind, "bot_challenge");
  checks++;
  assert.equal(value.access.account_ban_confirmed, false);
  assert.equal(value.access.http_status, null);
  checks++;
  await load("<title>Access denied</title><main>Error code: 1020</main>");
  assert.equal((await extract(page, "thread")).access.kind, "access_denied");
  checks++;
  await load(
    "<title>429 Too Many Requests</title><main>Too many requests</main>",
  );
  assert.equal((await extract(page, "thread")).access.kind, "rate_limited");
  checks++;
  await load(
    '<title>안내</title><div role="alert">회원님의 계정이 정지되었습니다</div>',
  );
  assert.equal(
    (await extract(page, "thread")).access.kind,
    "account_restriction_notice",
  );
  checks++;
  await load(
    '<title>Access denied 라는 글 제목</title><article><div class="boarddocument"><h1>synthetic topic</h1><div class="ugc-box">ordinary body</div><div id="comment">댓글 수 0</div><iframe src="https://challenges.cloudflare.com/test"></iframe></div></article>',
  );
  assert.equal((await extract(page, "thread")).data.body, "ordinary body");
  checks++;
  await load(
    '<article><div class="boarddocument"><h1>synthetic topic</h1><div class="ugc-box">ordinary</div><div id="comment">댓글 수 4</div><div class="comments"><div class="comment" id="C101"><div class="cboard"><img alt="APL" src="/synthetic.png"></div></div><div class="comment" id="C102"><div class="cboard">APL normal text</div></div><div class="comment" id="C103"><div class="cboard"></div></div><div data-comment-id="invalid"><div class="cboard">unknown identity</div></div></div></div></article>',
  );
  value = await extract(page, "thread");
  assert.equal(value.data.comments[0].content_kind, "media_only");
  assert.equal(value.data.comments[0].text, "");
  checks++;
  assert.equal(value.data.comments.length, 2);
  assert.equal(value.data.skipped_comments.length, 2);
  checks++;
  assert.equal(value.data.comment_coverage, "partial");
  assert.equal(value.data.expected_comments, 4);
  assert.equal(value.data.unavailable_comments, 0);
  checks++;
  assert.equal(value.data.comments[1].text, "APL normal text");
  checks++;

  await load(
    '<article><div class="boarddocument"><h1>synthetic</h1><img src="/avatar.png"><div class="ugc-box"><img data-src="/files/photo.png" src="data:image/gif;base64,AAAA" width="600" height="400" alt="synthetic photo"></div><span data-comment-count="1"></span><div class="comments"><div id="C55" class="comment"><div class="cboard"><img data-original="https://www.ipokergosu.com/uploads/reply.gif"></div></div></div></div></article>',
  );
  value = await extract(page, "thread");
  assert.equal(value.data.images.length, 1);
  assert.equal(
    value.data.images[0].url,
    "https://www.pokergosu.com/files/photo.png",
  );
  assert.equal(value.data.images[0].width, 600);
  assert.equal(
    value.data.comments[0].images[0].url,
    "https://www.ipokergosu.com/uploads/reply.gif",
  );
  assert.equal(value.data.comments[0].text, "");
  checks++;
  await load(
    '<h1>synthetic</h1><article><div class="post-content"><img src="javascript:void(0)"><img src="data:image/png;base64,AAAA"><img data-src="https://external.invalid/photo.jpg"></div></article><span data-comment-count="0"></span>',
  );
  value = await extract(page, "thread");
  assert.equal(value.data.images.length, 1);
  assert.equal(value.data.images_skipped, 2);
  assert.equal(value.data.images[0].url, "https://external.invalid/photo.jpg");
  checks++;
  await load(
    '<h1>synthetic</h1><article><div class="post-content">' +
      Array.from(
        { length: 103 },
        (_, i) => `<img data-src="/files/${i}.png">`,
      ).join("") +
      '</div></article><span data-comment-count="1"></span><div id="comment_1"><div class="comment-content"><img data-src="/files/reply.png"></div></div>',
  );
  value = await extract(page, "thread");
  assert.equal(value.data.images.length, 100);
  assert.equal(value.data.images_skipped, 3);
  assert.equal(value.data.comments[0].images.length, 0);
  assert.equal(value.data.comments[0].images_skipped, 1);
  checks++;
  await load(
    '<h1>synthetic</h1><article><div class="post-content"><span class="author">body impostor</span><time datetime="1999-01-01">body date</time></div><div id="comment_1"><div class="comment-content">parent text</div><div class="child-comments"><div id="comment_2"><span class="author">child writer</span><time datetime="2026-11-12T18:00:00+09:00"></time><div class="comment-content">child text</div></div></div></div></article><span data-comment-count="2"></span>',
  );
  value = await extract(page, "thread");
  assert.equal(value.data.author, "");
  assert.equal(value.data.published_at, null);
  assert.equal(value.data.comments[0].author, "");
  assert.equal(value.data.comments[0].published_at, null);
  assert.equal(value.data.comments[1].author, "child writer");
  checks++;
  await load(
    '<title>검색 - 포커고수</title><div class="w-full font-medium"><div class="lg:px-6"><p>"APL" 검색결과 1개</p><div class="boarddocument"><table><tr><td><a href="/free/123?s=1&v=APL">synthetic result</a></td></tr></table></div></div></div><aside><li><a href="/free/888">popular</a></li></aside>',
    "/free/search?s=1&v=APL",
  );
  value = await extract(page, "list");
  assert.deepEqual(value.data, [
    { id: "123", url: "https://www.pokergosu.com/free/123", pinned: false },
  ]);
  checks++;
  await load(
    '<title>검색 - 포커고수</title><main class="col-main"><p>"APL" 검색결과 &nbsp; 0개</p><table></table></main>',
    "/free/search?s=4&v=APL",
  );
  assert.deepEqual(await extract(page, "list"), { data: [], empty: true });
  checks++;
  await load(
    '<title>검색 - 포커고수</title><main class="col-main"><p>"APL" 검색결과 5개</p><table></table></main>',
    "/free/search?s=4&v=APL",
  );
  assert.equal((await extract(page, "list")).paused, "BOARD_MARKUP_UNKNOWN");
  checks++;
  await load(
    '<title>Just a moment...</title><div id="challenge-running">Verify human</div>',
    "/free/search?s=4&v=APL",
  );
  assert.equal((await extract(page, "list")).paused, "BOT_CHALLENGE");
  checks++;
  console.log(JSON.stringify({ checks, external_requests: 0 }));
} finally {
  await browser.close();
}
