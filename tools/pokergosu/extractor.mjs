/** Shared, self-contained DOM reader for Playwright and activeTab injection. */
export function extractDocument(operation) {
  const origin = "https://www.pokergosu.com";
  const commentSelector =
    '[data-comment-id], [id^="comment_"], [id^="comment-"], .comment-item, .comment_item, article.comment, .comments .comment[id^="C"]';
  if (
    location.origin !== origin ||
    !/^\/free(?:\/[1-9][0-9]*|\/search)?\/?$/.test(location.pathname)
  ) {
    return { paused: "OUTSIDE_FREE_BOARD" };
  }
  // A Turnstile widget in a readable comment form is not a blocked read.
  const readable =
    Boolean(
      document.querySelector(
        '.ugc-box,[itemprop="articleBody"],.post-content,.post_content,.document_content,.xe_content',
      ),
    ) ||
    (operation === "list" &&
      Boolean(
        document.querySelector(
          ".col-main table,main table,#board table,.boarddocument table",
        ),
      ));
  if (!readable) {
    const title = document.title.slice(0, 200);
    const visible = (document.body?.textContent || "")
      .replace(/\s+/g, " ")
      .slice(0, 3000);
    const indicators = [];
    let kind, reason;
    if (
      /\b429\b|too many requests/i.test(title) ||
      /^(?:\s*429\s+Too Many Requests)/i.test(visible)
    ) {
      kind = "rate_limited";
      reason = "RATE_LIMITED";
      indicators.push("rate-limit-error-text");
    } else if (
      /access denied|^403\b|forbidden/i.test(title) ||
      /(?:Error(?: code)?\s*:?\s*1020|Sorry, you have been blocked)/i.test(
        visible,
      )
    ) {
      kind = "access_denied";
      reason = "ACCESS_DENIED";
      indicators.push("access-denied-error-page");
      if (/1020/.test(visible)) indicators.push("displayed-error-1020");
      else if (/403/.test(title)) indicators.push("displayed-error-403");
    } else if (
      /just a moment|attention required/i.test(title) ||
      document.querySelector("#challenge-running,#challenge-stage") ||
      (document.querySelector('iframe[src*="challenges.cloudflare.com"]') &&
        /verify|human|보안 확인|사람인지/i.test(visible))
    ) {
      kind = "bot_challenge";
      reason = "BOT_CHALLENGE";
      if (/just a moment|attention required/i.test(title))
        indicators.push("challenge-page-title");
      if (document.querySelector("#challenge-running,#challenge-stage"))
        indicators.push("challenge-page-element");
      if (document.querySelector('iframe[src*="challenges.cloudflare.com"]'))
        indicators.push("challenge-frame");
    } else if (
      /계정(?:이|의 이용이)\s*(?:정지|차단)|이용이\s*영구\s*정지/.test(
        document.querySelector('[role="alert"]')?.textContent || "",
      )
    ) {
      kind = "account_restriction_notice";
      reason = "ACCOUNT_RESTRICTION_NOTICE";
      indicators.push("account-restriction-alert");
    }
    if (kind)
      return {
        paused: reason,
        access: {
          kind,
          title,
          indicators,
          basis: "visible-page",
          http_status: null,
          account_ban_confirmed: false,
        },
      };
  }

  const clean = (element) => {
    if (!element) return "";
    const copy = element.cloneNode(true);
    copy
      .querySelectorAll(`script,style,button,nav,${commentSelector}`)
      .forEach((e) => {
        e.remove();
      });
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  };
  const metadataText = (scope) => {
    if (!scope) return "";
    const copy = scope.cloneNode(true);
    copy
      .querySelectorAll(
        'script,style,input,textarea,form,[contenteditable],#editorbox,.edcomment,.ugc-box,[itemprop="articleBody"],.document_content,.document-content,.xe_content,.read-body,.post-content,.post_content,.comments,.child-comments,.cboard,.comment-content,.comment_content,.comment-body,.comment_body,.comment',
      )
      .forEach((node) => {
        node.remove();
      });
    return (copy.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  };
  // Capture references from content only; this function never fetches images.
  let imageBudget = 100;
  const imagesIn = (scope) => {
    const images = [],
      seen = new Set();
    let skipped = 0;
    for (const image of scope.querySelectorAll("img")) {
      const candidates = [
        image.getAttribute("data-original"),
        image.getAttribute("data-src"),
        image.getAttribute("data-lazy-src"),
        image.getAttribute("data-url"),
        image.currentSrc,
        image.getAttribute("src"),
        image.getAttribute("srcset")?.split(",").at(-1)?.trim().split(/\s+/)[0],
      ];
      let url;
      for (const candidate of candidates) {
        if (!candidate) continue;
        try {
          const parsed = new URL(candidate, location.href);
          if (
            parsed.protocol === "https:" &&
            !parsed.username &&
            !parsed.password &&
            parsed.href.length <= 2048
          ) {
            parsed.hash = "";
            url = parsed.href;
            break;
          }
        } catch {
          /* Try another declared image source. */
        }
      }
      if (!url || imageBudget <= 0) {
        skipped++;
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      imageBudget--;
      images.push({
        url,
        alt: (image.getAttribute("alt") || "").slice(0, 500),
        width: Math.min(
          100000,
          Math.max(
            0,
            image.naturalWidth || Number(image.getAttribute("width")) || 0,
          ),
        ),
        height: Math.min(
          100000,
          Math.max(
            0,
            image.naturalHeight || Number(image.getAttribute("height")) || 0,
          ),
        ),
      });
    }
    return { images, images_skipped: skipped };
  };
  if (operation === "list") {
    const heading = document.querySelector("h1");
    const search = location.pathname === "/free/search";
    const board =
      (search
        ? document.querySelector(".boarddocument")?.parentElement
        : null) ||
      document.querySelector("main,#content,#board,.board,.col-main");
    if (
      !board ||
      !(search
        ? /검색/.test(document.title) &&
          /검색\s*결과/.test(board.textContent || "")
        : [heading?.textContent, document.title].some((text) =>
            (text || "").replace(/\s+/g, "").includes("자유게시판"),
          )) ||
      !["/free", "/free/search"].includes(location.pathname)
    ) {
      return { paused: "BOARD_MARKUP_UNKNOWN" };
    }
    const links = new Map();
    for (const a of board.querySelectorAll("a[href]")) {
      const url = new URL(a.getAttribute("href"), origin);
      const match = url.pathname.match(/^\/free\/([1-9][0-9]*)\/?$/);
      // Sidebar and popular-post links must not advance the board cursor.
      if (
        url.origin !== origin ||
        !match ||
        a.closest("aside,nav,footer,header,.popular,.popular-posts")
      )
        continue;
      const container = a.closest(
        "tr,li,article,[data-post-id],.list-item,.list_item",
      );
      if (!container) continue;
      const text = clean(a);
      if (!text || /^\[?\d+\]?$/.test(text)) continue;
      const noticeMarker =
        container.querySelector("td:first-child") || container;
      const labelledNotice = [
        ...noticeMarker.querySelectorAll("span,b,strong"),
      ].some((node) =>
        /^(공지|알림|필독)$/.test((node.textContent || "").trim()),
      );
      const pinned =
        labelledNotice ||
        container.matches('.notice,.is-notice,.pinned,[data-notice="true"]') ||
        Boolean(
          container.querySelector(
            '.notice,.notice-label,.pinned,[title="공지"],img[alt="공지"]',
          ),
        );
      links.set(match[1], {
        id: match[1],
        url: `${origin}/free/${match[1]}`,
        pinned,
      });
    }
    if (!links.size) {
      if (
        search &&
        /검색\s*결과\s*0\s*개/.test(
          (board.textContent || "").replace(/\u00a0/g, " "),
        ) &&
        board.querySelector("table")
      )
        return { data: [], empty: true };
      return { paused: "BOARD_MARKUP_UNKNOWN" };
    }
    return { data: [...links.values()] };
  }
  const id = location.pathname.match(/^\/free\/([1-9][0-9]*)\/?$/)?.[1];
  const title = document.querySelector(
    "h1,.document-title,.document_title,.np_18px_span",
  );
  const body = document.querySelector(
    '.boarddocument .ugc-box,[itemprop="articleBody"],.document_content,.document-content,.rd_body .xe_content,article .xe_content,.read-body,.post-content,.post_content,.xe_content',
  );
  if (
    !id ||
    !title ||
    !body ||
    (!clean(body) && !body.querySelector("img,video,audio,iframe"))
  )
    return { paused: "THREAD_MARKUP_UNKNOWN" };
  const postScope =
    body.closest(".boarddocument,article,.document,.rd_body") ||
    body.parentElement;
  const postMetaNode = (selector) =>
    [...(postScope?.querySelectorAll(selector) || [])].find(
      (element) =>
        !body.contains(element) &&
        !element.closest(commentSelector) &&
        !element.closest("form,nav,aside,footer"),
    );
  const postImages = imagesIn(body);
  const comments = [];
  const skippedComments = [];
  const seenCommentIds = new Set();
  for (const node of document.querySelectorAll(commentSelector)) {
    const rawId =
      node.getAttribute("data-comment-id") ||
      node.id.match(/^(?:comment[_-]|C)(\d+)$/)?.[1];
    const commentId =
      typeof rawId === "string" && /^[1-9][0-9]{0,18}$/.test(rawId)
        ? rawId
        : null;
    const content = node.querySelector(
      '.cboard,.comment-content,.comment_content,.comment-body,.comment_body,.xe_content,[itemprop="text"],.content',
    );
    // Comment form/control IDs are not actual comments.
    if (
      !content &&
      !commentId &&
      !node.matches(
        "[data-comment-id],.comment-item,.comment_item,article.comment,.comment",
      )
    )
      continue;
    if (commentId && seenCommentIds.has(commentId)) continue;
    if (commentId) seenCommentIds.add(commentId);
    if (!commentId) {
      skippedComments.push({ id: null, reason: "MISSING_OR_INVALID_ID" });
      continue;
    }
    if (!content) {
      skippedComments.push({ id: commentId, reason: "CONTENT_NOT_FOUND" });
      continue;
    }
    const text = clean(content);
    const hasMedia = Boolean(
      content.querySelector("img,picture,video,audio,iframe,svg"),
    );
    if (!text && !hasMedia) {
      skippedComments.push({ id: commentId, reason: "EMPTY_OR_UNREADABLE" });
      continue;
    }
    const parent = node.parentElement?.closest(commentSelector);
    comments.push({
      id: commentId,
      text,
      has_media: hasMedia,
      content_kind: hasMedia ? (text ? "mixed" : "media_only") : "text",
      ...imagesIn(content),
      metadata_text: metadataText(node),
      author: clean(
        [
          ...node.querySelectorAll(
            '.author,.nickname,.nick,[itemprop="author"]',
          ),
        ].find(
          (element) =>
            !content.contains(element) &&
            element.closest(commentSelector) === node,
        ),
      ),
      published_at: (() => {
        const element = [...node.querySelectorAll("time,.date,.time")].find(
          (element) =>
            !content.contains(element) &&
            element.closest(commentSelector) === node,
        );
        return element?.getAttribute("datetime") || clean(element) || null;
      })(),
      parent_id:
        parent?.getAttribute("data-comment-id") ||
        parent?.id.match(/^(?:comment[_-]|C)(\d+)$/)?.[1] ||
        null,
    });
  }
  const countContainer = document.querySelector("#comment") || document.body;
  // biome-ignore lint/performance/useDomNodeTextContent: Count labels require rendered whitespace between elements.
  const countLabel = countContainer.innerText;
  const countText = countLabel.match(/댓글\s*(?:수)?\s*[:(]?\s*([0-9,]+)/);
  const countNode = document.querySelector("[data-comment-count]");
  const expected = countNode
    ? Number(countNode.getAttribute("data-comment-count"))
    : countText
      ? Number(countText[1].replaceAll(",", ""))
      : null;
  const accounted = comments.length + skippedComments.length;
  const knownCount = Number.isInteger(expected) && expected >= accounted;
  const unavailable = knownCount ? expected - accounted : null;
  const coverage = !knownCount
    ? "unknown"
    : skippedComments.length || unavailable
      ? "partial"
      : "visible-complete";
  return {
    data: {
      id,
      source: "pokergosu",
      board: "free",
      url: `${origin}/free/${id}`,
      title: clean(title),
      body: clean(body),
      ...postImages,
      metadata_text: metadataText(postScope),
      author: clean(
        postMetaNode('.author,.nickname,.nick,[itemprop="author"]'),
      ),
      published_at:
        postMetaNode("time[datetime]")?.getAttribute("datetime") || null,
      comments,
      expected_comments: knownCount ? expected : null,
      reported_comments: Number.isInteger(expected) ? expected : null,
      skipped_comments: skippedComments,
      unavailable_comments: unavailable,
      comment_coverage: coverage,
    },
  };
}
