# Pokergosu public-board monitor

Implemented 2026-11-10 as an independent local collector in `tools/pokergosu`.
It reads the Mention workspace's authoritative include keyword settings;
it never logs into, restarts, duplicates or writes to the Kakao collector.
No changes to the existing web process, dashboard routes or classifications are
required. Collected site records are currently available through CLI JSON export,
not the Kakao conversation UI. No message delivery or AI processing is enabled.

## Status

- Implemented: lifecycle, keyword adapter, bounded discovery, independent comment
  matching, recent-thread refresh, isolated persistence, revision history,
  randomized scheduling, stop conditions and paged JSON export.
- Tested: synthetic Python policy/storage/source contracts and Chrome DOM contracts;
  all browser test requests are intercepted with synthetic fixtures.
- Live attempt: robots.txt could be read; the first `/free` request returned an
  access restriction. The collector persisted `paused: true` with
  `reason: ACCESS_RESTRICTED`, then closed its browser. No post/comment records were
  captured. No recurring process was started. Actual site HTML selectors remain
  unverified. Synthetic extraction success does not establish live compatibility.
- Deployment: no web deployment or Kakao restart. The manual extension receiver
  can run separately on loopback without any website polling.
- Access limitation: the current browser adapter is Playwright-controlled Chrome.
  Cloudflare does not support automation frameworks for solving production
  challenges. A manual challenge followed by headless profile reuse is an
  unverified experiment, not a demonstrated solution. The manual activeTab extension described below now reads pages in the user's
  accessible session. It has passed synthetic real-Chrome installation/action
  testing; live Pokergosu content access still needs the user's installed browser.

## Dependencies and boundaries

Use the project's existing Node and `@playwright/test` installation, Python 3.9+
(standard library only) and installed Google Chrome. `MENTION_CHROME` can select a
compatible browser executable. No new package, server, queue or database engine
was added. Browser automation is intentionally an adapter; collection orchestration
and eligibility policy do not depend on DOM/Playwright APIs.

`MENTION_LEGACY_ROOT`, `--legacy-root`, or `runtime/deployment.json` selects the
existing keyword source. Priority is explicit CLI option, environment, deployment.
Only `settings.keywords` is read through SQLite
`mode=ro`/`query_only`; no source database or runtime file is copied. The pure
`monitor/rules.py` matcher is loaded without writing bytecode into that workspace.
No Store constructor, collector entrypoint, IPC mutation or private table is used.

The initial inspected source had **47 include keywords**. They are reloaded each
cycle rather than embedded in source code. Per the user's 2026-11-10 instruction,
Pokergosu ignores all exclusion keywords; the existing Kakao settings remain intact.
Exclusion values are not read or validated by this collector.
In particular, `ㅈPL` was **not** an existing include keyword. This implementation
does not silently add it or change any authoritative settings. Add desired
variants through Mention's existing keyword settings. Matching uses the existing
Unicode/spacing/acronym include matching rules exactly.

## Lifecycle

Run from `/Users/we/mention` using one entrypoint:

```sh
./scripts/pokergosu.sh keywords       # read current include settings; exclusions ignored
./scripts/pokergosu.sh status         # last outcome, pause, next due time, gaps
./scripts/pokergosu.sh once           # one due cycle; respects pauses and due time
./scripts/pokergosu.sh start          # detached periodic worker, single file lock
./scripts/pokergosu.sh stop           # signal only this collector's verified PID
./scripts/pokergosu.sh export --limit 100
./scripts/pokergosu.sh export --limit 100 --before 123456789
```

State, local browser profile, public records and logs are private files under
ignored `runtime/pokergosu/`. The runtime location is fixed so alternate directory
arguments cannot bypass the singleton lock. No other worker/schedule is changed.
There is no OS login auto-start installation. `start` does not clear a pause.

For a paused access check, the user can open the collector's own browser profile:

```sh
./scripts/pokergosu.sh setup
```

This opens the public board in a normal headed Chrome window. Complete any normal
human verification yourself, then close that browser window. Do not log in: this
monitor is limited to public content. The program never solves a challenge,
rotates proxies or imports another browser's cookies. A browser check may still
fail, and a headed session does not guarantee later headless access.

After inspecting the pause reason and addressing the cause:

```sh
./scripts/pokergosu.sh resume
./scripts/pokergosu.sh start
```

`resume` only clears the durable pause and chooses a fresh 15–30 minute delay; it
does not request the website. Unknown markup/partial-comment pauses need an adapter
fix and synthetic contract coverage, rather than repeated access attempts.

## Collection scope and load

- Pick the next cycle's delay uniformly between 900 and 1800 seconds, after a
  cycle completes. Persist due time before browser requests so a crash/restart
  does not immediately hammer the site. Randomness does not prevent detection.
- Respect robots.txt, cache it at most 24 hours, and honor its crawl delay when
  greater than the usual sequential 8–15 second inter-navigation delay. No parallel
  website requests are issued by the application. Normal browser subresources
  still create additional network traffic; counts below are page navigations.
- Bootstrap the current newest list page only. Later cycles scan at most three
  pages toward the previous frontier. A missing frontier records a durable
  `discovery_gap`; it does not claim full historical coverage or backfill beyond
  the bound. The last gap remains inspectable even after a later normal cycle.
- Fetch at most twelve thread pages per cycle: at most eight never-read threads,
  with remaining slots assigned to the oldest checked threads first. This reserves
  capacity for comment rechecks when the new-post queue is busy. Pending counts
  reveal lag. A busy board can create a growing backlog and delayed detection.
- Recheck threads for 72 hours **after discovery**, including previously unmatched
  threads, so a keyword first appearing in a comment can qualify. Rechecks rotate;
  every thread is not guaranteed to be revisited every cycle. Later comments on
  older threads and historical threads outside discovery scope are not covered.
- Maximum normal cycle: one robots navigation if expired, three list pages and
  twelve thread pages (sixteen navigations), plus normal page subresources.
- Match the title/body as one unit and each comment independently, using include
  keywords only. Exclusion keywords never suppress either. Retain thread context
  locally; the export selects threads with at least one eligible post or comment.
  A comment without its own keyword is context, not independently eligible evidence.
- Save public source URL, source/board identity, post/comment IDs, available author
  and time, parent reply IDs and observed revisions. Do not infer sentiment or
  create AI/human correction records. No attachment/image downloads are performed.
- Preserve old content revisions instead of deleting history when content changes.
  Re-evaluate retained content on a keyword-settings revision at the next cycle.
  An export made before that cycle still reflects the previous matching settings.

## Failure behavior and limits

401/403/429, a visible browser challenge, unexpected redirects, robots disallow,
unknown board/post markup or inconsistent comment counts pause collection durably.
A comment count greater than extracted visible comments does not silently produce
an incomplete record: hidden/paginated comments currently cause a pause. Automated
comment expansion/pagination needs actual live structure evidence before support.

Navigation/transport errors back off exponentially; three consecutive failures
pause the worker. There are no automatic mutation requests or challenge retries.
Signals drain the current bounded navigation and close the owned browser/profile.
A stop request is not an assertion of instantaneous browser termination.

Current selectors support semantic/XE-style markup candidates and are validated
against synthetic documents only. No claim is made about the site's backend,
framework or actual complete extraction until a successful live read is obtained.
Robots instructions are a technical input, not a guarantee against account/IP
restrictions. The observed content signals allow search and disallow AI training;
this program does not train models or feed collected content to an AI service.

## Verification

```sh
npx --yes pnpm@9.15.9 exec vitest run tests/pokergosu.test.ts
npx --yes pnpm@9.15.9 typecheck
npx --yes pnpm@9.15.9 exec biome check tools/pokergosu/browser.mjs tests/pokergosu.test.ts tests/pokergosu-browser-check.mjs
```

No real keyword save, Kakao action, private-message fixture or collector restart
was used for this implementation.

## Manual Chrome extension trial — 2026-11-11

A Manifest V3 extension now captures the page explicitly selected by the user.
Version0.1 was the first manual access experiment. Version0.2 adds the explicit
15-check board trial below; manual captures still make no website requests. The
extension has no site-wide host permission, static content scripts or cookie
permission. `activeTab` grants temporary access
only when the user presses the action. Controls are native Chrome action/menu/
badge/title APIs; no custom HTML UI or additional component system is introduced.

```sh
./scripts/pokergosu.sh extension-prepare
./scripts/pokergosu.sh extension-start
```

Preparation builds the locally loadable package at:

`/Users/we/mention/runtime/pokergosu/extension`

In normal Chrome, open `chrome://extensions`, enable developer mode, choose
**압축해제된 확장 프로그램을 로드합니다**, and select that folder. Pin
**Mention · 포커고수 읽기** from Chrome's extensions menu. No Web Store upload or
browser restart is needed. Load this generated folder, not the source template
under tools/: the generated folder contains the shared reader and a private
connection configuration. Never publish/share its connection.json or local token.

Open a free-board post normally, wait until it is readable, and press the extension
button. It reads the visible title/body/comments and submits them to the receiver.
The badge becomes **발견** for an include-keyword match, **저장** otherwise,
**목록** for discovered links, or **!** for an error. Hover over the button for the
result text. Right-click the extension button and choose **로컬 연결 확인** to
check receiver availability and stored/matched counts.

On the board list, the action records visible thread URLs only. It does not open
those threads: open a post yourself and press the action again to read its content.
Manual mode performs no periodic refresh or new-tab automation; the separately
started 15-check trial below is bounded and opt-in. If a page layout
is unknown or visible comments do not match the displayed total, content is not
saved as complete. A bounded structural diagnostic (tag/class/ID, heading text;
no input values, scripts, cookies or full HTML) is saved locally for investigation.
Challenges are displayed as errors without automatic retry or challenge solving.

```sh
./scripts/pokergosu.sh status          # extension capture/structural diagnostic
./scripts/pokergosu.sh export          # matching stored threads, with comments
./scripts/pokergosu.sh extension-stop  # stop the local receiver
```

The receiver binds **127.0.0.1:8791 only**, never the public web/tunnel. A generated
local token authenticates requests; exact Host, extension ID/Origin, content type,
payload size, source URL, stable IDs and complete comment counts are checked.
The token is only in ignored local files and never enters the site page. Existing
Kakao include matching is reused; exclusions are ignored. The source DB is read
only. The receiver and headless worker share a single lifecycle lock; do not run
both. The old headless ACCESS_RESTRICTED state remains historical and does not
prevent explicit extension captures. The extension's latest result is recorded
separately under extension_capture in status.

The current installation is local only. After source updates, run
extension-prepare and click Chrome's extension reload button. With the local
receiver stopped, captures fail visibly; they are not silently queued or retried.

### Extension verification

- Nine synthetic Python tests cover capture validation, source identity,
  independent comment eligibility, revision deduplication, secret packaging,
  wrong-Origin/Host/auth rejection and request-size limits.
- Fourteen browser/extension-adapter assertions cover active-page extraction,
  single in-flight capture, no automatic website requests, diagnostics without
  input values, challenge handling and local receiver failure.
- `node tests/pokergosu-extension-e2e.mjs` installs the unpacked extension in an
  isolated Chrome profile and triggers its actual action on an intercepted
  synthetic page. Actual activeTab injection and authenticated loopback delivery
  passed. This standalone test requires port8791 to be free; stop the local
  extension receiver before running it. It never uses production storage.
- Full suite wrappers are in tests/pokergosu.test.ts. Chrome installation and
  synthetic page success do not establish that live Pokergosu selectors match.

Repository verification at the end of this trial: the full suite passed (68 tests),
TypeScript checking passed, and extension-specific format/lint checks passed.
The repository-wide format check still reports the existing JSON code block in
`docs/SENTIMENT-CLASSIFIER.md`; this separate work document was left unchanged.

### First user-browser diagnostic and reader fix (0.1.1)

The installed extension reached the local receiver from a real free-board post.
It recorded THREAD_MARKUP_UNKNOWN, establishing that page access and transport
worked while the initial speculative selectors did not match. The observed
structural diagnostic identifies .boarddocument .ugc-box for post content,
.comments .comment with C-prefixed numeric IDs, .cboard for comment text, and
.col-main for the board area. The shared reader now supports those selectors,
scopes the comment count to its header, and permits a media-only body with empty
text. Six additional synthetic assertions cover this structure, nested replies,
body text resembling a comment count, media-only posts and board lists. No real
post text was copied into tests. Reload the unpacked extension after preparing
version0.1.1; no page refresh or local receiver restart is needed. Successful live
content capture remains to be verified after that reload.

## Finite 15-check trial — version0.2.0

The user explicitly requested **fifteen checks only**, retaining the random
15–30 minute interval. This trial refreshes **only the first free-board list** in
the tab explicitly selected through Chrome's action context menu. It discovers
visible post URLs; it does not open thread pages or collect their comments in this
trial. A successful trial is evidence about this request load only, not the larger
load of future full post/comment monitoring or proof against a future ban.

1. Run extension-prepare and reload **Mention · 포커고수 읽기** at
   chrome://extensions (version0.2.0 adds Chrome's alarms permission).
2. Open https://www.pokergosu.com/free in a dedicated tab.
3. Right-click the extension action and select
   **자유 게시판 15회 시험 시작 (이 탭)**.

The user already authorized the bounded trial; this native click is necessary for
Chrome to grant activeTab access to that tab. The baseline reads the loaded list
without a website request, validates the reader/receiver, and arms the first
one-shot alarm 15–30 minutes later. Subsequent delays are independently randomized.
A normal fifteen-check run takes225–450 minutes plus page loading and any device
sleep. Keep Chrome and that tab open and leave the tab on the first list. Sleep
can delay alarms; waking does not cause a catch-up burst.

The badge shows the attempted count and then **완료** or **중지**. Hover for the
success count and next check time. Native menu actions **15회 시험 상태 확인** and
**15회 시험 중지** display progress or cancel future alarms. No further user
approval is required per check and the trial never starts another batch itself.

Before each reload, one of the fifteen slots is durably claimed and its in-flight
record is mirrored to the authenticated local receiver. Each completed attempt
records timestamps and outcome. Ambiguous in-flight work after a worker restart
becomes unknown and stops; it is never retried. Tab closure, navigation away,
permission loss, navigation failure, unknown/blocked markup and local receiver
failure stop future checks. A failure before a reload can consume a slot without
issuing a website request, so the upper bound is fifteen reload attempts, not a
promise to perform fifteen after an error. An already-started navigation may finish
after the user presses stop; no following check is scheduled.

One-shot alarms and chrome.storage preserve waiting progress across normal worker
suspension. Chrome restart can revoke activeTab access; the trial then stops instead
of requesting new permissions or silently switching tabs. Account status is not
queried. The program distinguishes observed page access failure from an account ban.

`./scripts/pokergosu.sh status` includes **extension_trial** with attempted,
successful, nextAt, reason, and per-attempt history (epoch milliseconds). The server
stores each run separately, enforces limit15, rejects counter regression and keeps
finished history immutable. It rejects reactivation of a terminal run. The extension
retains a local copy if the receiver becomes unavailable. Collected content remains
separate from this operational audit.

Verification: eighteen virtual-clock assertions exercise all fifteen successful
checks and no sixteenth reload, jitter bounds, stop-on-challenge, early alarms,
receiver outages, worker interruption, changed/closed tabs, cancellation during a
reload, overlapping alarms, duplicate start and delayed wake-up. The isolated
real-Chrome test also arms an actual alarm, performs one actual tab reload against
intercepted synthetic HTML with retained activeTab access, and clears the alarm
on stop. Test-only clock advancement is confined to the isolated fixture; the user
package contains no fast-forward command. No live fifteen-check result is claimed
until the user reloads the extension, starts the menu action, and it finishes.

## Automatic post/comment collection — version0.3.0

After stopping the list trial at four successful checks, the user authorized
implementing collection that does not require a physical click for each post.
The old fifteen-check trial remains stopped with its original audit. It is not
silently resumed or converted into an unlimited trial. The separate automatic
monitor starts only through **자동 수집 시작 (이 탭)** in the extension action menu.

### Starting and everyday operation

1. Run `./scripts/pokergosu.sh extension-prepare`, then reload the extension at
   chrome://extensions. No new permissions beyond version0.2 are requested.
2. Open https://www.pokergosu.com/free in a dedicated tab, then choose
   **자동 수집 시작 (이 탭)** from the extension button's right-click menu.
3. Leave Chrome, that tab and the local receiver running. Other tabs can be used
   normally. The monitor changes only its bound tab's URL without activating it.

The initial already-loaded list is captured without an additional site request.
The first fresh-list reload is scheduled30–45seconds later; the first thread
visit follows another30–45second step. This prevents an old open list from
producing a fast but stale first cycle. One navigation
runs per Chrome alarm, so the service worker can suspend normally between steps.
Every page is validated and saved to the local receiver before the next step is
scheduled. After finishing a cycle it returns to the first list and waits a fresh
random15–30minutes. This interval is after cycle completion, not a promise to scan
the entire board every15minutes. Page visits within a cycle use30–45second gaps,
plus loading/validation time. The badge shows **자동**, **대기** or **중지**; hover
for cumulative thread reads, eligible captures, completed cycles and next time.
Read counts include rechecks and are not counts of distinct collected posts.
**자동 수집 상태 확인** and **자동 수집 중지** are available in the same menu.

A normal cycle selects at most six thread pages: up to four newest unread records
and at least two oldest-checked recent records when available. With fewer unread
records, more slots are available for rechecks. All comments are checked separately
from the post, including comments on previously unmatched threads. The active
window is72hours after discovery. Older unprocessed URLs remain saved and are
reported as historical pending records, not falsely marked collected. A busy board
can produce a backlog. Retained text is re-evaluated when include keywords change;
unchanged settings no longer trigger a whole-content reclassification per thread.
Exclusion keywords are neither read nor applied.

On later cycles the monitor looks for overlap with the previous first-page IDs,
ignoring detected pinned notices. It reads at most three list pages before
recording a discovery-gap warning. Then it processes at most six threads and
returns to the first list. This bounds a cycle to at most ten main-frame visits
(3lists + 6threads + 1return), plus normal browser subresources. The initial cycle
validates the loaded list, then refreshes it and can take at most eight visits. This is a higher request
load than the previous list-only trial; four successful list checks do not prove
that the full load will remain unrestricted.

### Integrity, pauses and recovery

Canonical post URLs and IDs are validated in both the extension and local receiver.
Only the same source origin is permitted. The receiver provides a bounded queue
through authenticated `/plan`; page content cannot provide arbitrary navigation
commands. Full title/body/comment text is stored with observed revisions and
independent include matches. Comment totals must match the extracted visible
comments. Hidden/paginated comments, unknown markup, access checks, redirects,
navigation failures, changed/closed tabs and local receiver outages pause the
monitor; no partial page is silently labelled complete. No challenge solving,
proxy rotation, site mutation requests or automatic error retry is introduced.

Each navigation is claimed in extension storage and mirrored to the receiver
before a site visit. The extension retains the last50 events; the receiver archives
every event under `extension_monitor_event:<run-id>:<sequence>`. Finished event
identity/content is immutable. Each start has an independent run ID and terminal
runs cannot be reactivated. Navigation counters and cycle request budgets are
validated. `./scripts/pokergosu.sh status` includes `extension_monitor` with phase,
nextAt, cycles, pending count, metadata warnings and navigation history. Waiting
work is restored after ordinary worker suspension without a catch-up burst.
An ambiguous in-flight navigation after worker termination becomes unknown and
pauses; it is not repeated. User stop cancels future steps; an already-issued
navigation can finish. The list trial and automatic monitor cannot run together.

Chrome restart can revoke the temporary activeTab grant or replace tab IDs. In
that case a user may need to open the list and start again. This implementation
does not install an OS login daemon, relaunch Chrome or bypass a human access check.
The local receiver retains its existing separate lifecycle and loopback-only scope.

### Author/time coverage

The original live sample contained complete visible body/comments but no parsed
author/time fields. The automatic reader now also preserves bounded visible header
text per post/comment as `metadata_text`, separately from the content used for
keyword matching. It strips post/comment bodies, scripts, inputs, editable drafts
and forms from this evidence. This preserves public author/date UI evidence for
later parser improvement without inventing attribution. Structured author/time
fields can still be unavailable and are explicitly counted as metadata warnings.
This is not a claim of fully parsed author/date metadata. Missing fields do not
silently acquire inferred values or influence sentiment/human correction records.

### Verification and measured limits

Twenty-one virtual-clock assertions cover automatic thread/reply captures, returning
to the board,15–30minute cycle spacing,30–45second page gaps, the3-page/6-thread/
10-visit cap, gap warnings, receiver failure, changed/closed tabs, worker interruption,
manual stop during navigation, overlapping alarms and trial/monitor exclusion.
Seven synthetic Python tests cover queue fairness/age limits, HTTP plan contracts,
comment-only matches, retained metadata, unchanged-keyword processing, immutable
navigation history beyond50 events, stopped trial preservation, terminal-run guards
and source/counter validation. The DOM contracts include Korean notice labels and
metadata evidence without body/draft leakage. Fixtures contain synthetic text only.

The isolated native Chrome integration loaded the real unpacked package, retained
activeTab access across an automatic move to a thread and back to the board,
transferred a populated post/comment capture to an authenticated loopback receiver,
and scheduled the next cycle without further action clicks. Actual monitor messages
were checked against the Python monitor validator. Native Chrome alarms, not
repeated action clicks, drove the automatic steps in the isolated fixture. Useful
populated capture timing is measured after accelerated test alarms; normal live
startup includes60–90seconds of deliberate step waiting plus site load time. The
small synthetic payload omits real-site assets and is not a production bandwidth
measurement. Live automatic collection remains to be verified after the user
updates and starts version0.3.0. No production Kakao
worker, login, schedule or operational database was changed.

Version0.3 keeps the three automatic-monitor actions directly in the native menu.
The previous finite trial actions are under **15회 시험**, keeping at most six
top-level items within Chrome's action-menu limit. Start/stop remain accessible;
no custom popup or new styling system was added. Final checks passed71 repository
tests and TypeScript checking. The latest isolated native-alarm run produced the
first synthetic populated thread/comment capture about3.3seconds after accelerated
due events (fresh list plus thread), with a431-byte capture payload. Production
startup still includes60–90seconds of intentional waiting and real site resources.

## Operational access logs — version0.3.1

The user requested a durable record of normal collection, access denial versus
bot/human verification, and the visit count before a restriction. Existing
SQLite navigation archives remain canonical. The receiver now projects changes
automatically into ignored, owner-private:

`runtime/pokergosu/collection-events.jsonl`

A navigation has a run ID, request number, cycle, requested URL, start/finish times,
outcome, category and reason. In-flight and final updates share a request number;
**do not count JSONL lines as visits**. Run-state rows record progress, cumulative
thread reads, cycle completion and the next scheduled check. Old canonical events
are backfilled on receiver startup. File projection errors are exposed through
`collection_log_error` while the already-committed canonical DB remains available.
A file flush followed by a crash before the deduplication-marker commit can
repeat an event ID; identical IDs can be deduplicated. Historical SQLite events
are retained beyond Chrome's last50-event window.

```sh
./scripts/pokergosu.sh logs          # canonical per-run summary and all visits
./scripts/pokergosu.sh logs --jsonl  # one current state row/run plus visit rows
```

The report identifies the first issue per run, its request number and the number
of successful prior visits. `all_runs_request_number` also orders visits across
separate starts, while the previous finite trial remains separate. The exported
`runtime/pokergosu/access-events.jsonl` is a point-in-time report, whereas
collection-events.jsonl is the live append-only projection. The report reads
only allowlisted operational state in mode=ro/query_only; post bodies, comments,
keyword settings, cookies and tokens are not placed in these operational logs.
Visit counts are main-frame navigation attempts, not counts of image/advertising
HTTP requests. A slot claimed before a failed local checkpoint may not have issued
a website request.

The new DOM classifier distinguishes:

- `bot_challenge`: a full-page verification title/element or challenge frame with
  matching verification text, without a readable article/list.
- `access_denied`: explicit access-denied/forbidden/1020 error-page evidence.
- `rate_limited`: an explicit429/Too Many Requests page.
- `account_restriction_notice`: a matching account-restriction alert without
  readable content. This records a notice, not independent account-status proof.
- `normal`, parser/coverage failure, local failure, navigation failure, user stop
  and unknown access restriction remain separate outcomes.

A normal article discussing bans, or an inline verification widget in a readable
comment form, is not counted as a blocked read. Evidence is limited to bounded
page title and indicator labels. No screenshot, body, form value, cookie or token
is copied into the access evidence. The extension does not observe HTTP response
headers, so `http_status` remains null even when a displayed error code is detected.
`account_ban_confirmed` remains false: a visible Cloudflare/error page does not
establish an account ban. Observation occurs at the scheduled DOM read, not at
every intermediate browser frame; a transient verification page that resolved
before observation may not be recorded.

Deployment distinction: the live receiver log can record the currently running
version0.3.0 without restarting the extension. That client reports generic
ACCESS_RESTRICTED and has no detailed evidence; old events are explicitly
`access_restricted_unknown` and are never retroactively guessed as bans/challenges.
To obtain the new per-page distinctions, reload the prepared version0.3.1 while
waiting between cycles, then invoke **자동 수집 시작 (이 탭)** on the bound board tab
once to renew Chrome's temporary grant. If the existing run is still waiting, its
ID/counts are retained. The receiver was refreshed during a verified resting
window, preserving the active run and the stopped four-check trial. No new
collector or watcher process, website request, OS schedule or Kakao change was
introduced for logging.

Verification adds seven synthetic log tests (precise issue ordinal/prior successes,
legacy uncertainty, error categories, evidence allowlist, no invented HTTP status,
read-only reporting without message content, automatic/idempotent JSONL writes,
projection failure and history beyond50 events) and six real-browser DOM cases
for the classifications and false-positive guards. The automatic controller also
tests preservation of page evidence through its stop/audit path. Operational logs
continue automatically after the one-time extension update; no per-visit clicks
or per-incident log export is required.

## Unreadable-comment continuation policy — version0.3.2

The user identified the stopped comment as image-only and explicitly required
skipping uninterpretable comments instead of halting the whole monitor. This
supersedes earlier comment-count/individual-comment stop rules. Post structure,
access restrictions, source identity and transport failures still pause collection.
The existing paused run is retained; preparing or reloading this patch does not
resume it.

- An image/media-only comment keeps its stable ID, empty text, `has_media: true`
  and `content_kind: media_only`. It counts as a retained visible comment, but its
  image is not downloaded, OCRed, keyword-matched or given a sentiment label.
- A comment with invalid/missing identity, missing content container or empty
  non-media content is recorded in `skipped_comments` with a reason. Remaining
  comments and later posts continue normally. No invented ID is assigned.
- A known total with missing/unrendered comments becomes `partial`, with
  `unavailable_comments` recording the missing count. An absent or contradictory
  count becomes `unknown`; it is never claimed complete. `reported_comments`
  preserves an available displayed total. This does not automatically expand
  hidden/paginated comments or pretend that those comments were read.
- The receiver validates the accounting and still rejects a payload falsely
  marked `visible-complete`. Comment metadata and available text remain separate
  from omissions. Text-only keyword matching ignores image content and metadata.
- A per-page `comment_summary` (saved/media-only/skipped/unavailable/coverage) is
  retained in the immutable navigation audit, live JSONL and read-only reports.
  Successful partial reads are normal visits with explicit omissions, not evidence
  of a ban or a false assertion that all comment contents were interpreted.

Synthetic browser checks cover mixed text/image comments, empty comments, invalid
IDs, unknown totals and unrendered comments. Backend tests cover partial/unknown
accounting, independent text matches, retained skip reasons and non-matching empty
media text. The isolated Chrome alarm test captures mixed comments, records a skip,
returns to the list and schedules another cycle without a physical action click.
These are synthetic checks; the original stopped page remains preserved in audit
and has not been automatically retried.

## Local browser control — version0.4.0

The optional persistent origin permission is limited to
`https://www.pokergosu.com/*`. Required host permissions remain loopback only.
After the initial extension reload, use the extension action's native context
menu: `설정·로컬 제어` → `로컬 제어 연결 (사이트 권한 허용)`, then accept Chrome's
permission prompt. The request runs directly in that native user gesture. The
extension is private/unpacked; no Web Store publication is needed.

Granting permission enables authenticated loopback command polling every30 seconds;
it does not enqueue a collection run. There is no per-post click requirement.
Chrome and the local receiver must remain running and the Mac awake. This change
does not install an OS login daemon or start a stopped Chrome process.

Use the existing lifecycle entrypoint:

```sh
bash scripts/pokergosu.sh extension-start
bash scripts/pokergosu.sh control-status
bash scripts/pokergosu.sh monitor-start
bash scripts/pokergosu.sh monitor-resume
bash scripts/pokergosu.sh monitor-stop
# After preparing updated source, request a reload from the connected extension.
bash scripts/pokergosu.sh extension-prepare
bash scripts/pokergosu.sh extension-reload
```

Start/resume creates a new audited run, reusing a still-bound tab or creating a
separate inactive tab. It never commandeers an unrelated tab. Existing15–30 minute
collection spacing and bounded thread traversal remain in force; the30 second
control heartbeat accesses localhost only. `control-status` distinguishes queued,
leased, succeeded, failed and unknown outcomes. A queued receipt is not evidence
that collection actually started.

Commands and append-only control events live in the independent collector SQLite
DB, separate from navigation/access JSONL. Commands have a120 second execution
lease; ambiguous interrupted actions are not replayed. Completed receipts can be
retried without repeating the action. One extension instance owns the receiver for
90 seconds at a time. Manual stop timestamps reject stale queued starts. Security
holds reject local resume without navigating to the site. Permission revocation
stops an active monitor on its next local poll. Disabling local control removes
the optional site permission and stops collection. Receiver/extension restart
alone does not create a new run or resume a manually stopped run.

Reload stores a receipt before restarting the extension and confirms the target
manifest version in the next worker. Initial installation of this version still
requires one manual reload because older extensions do not have a control listener.
Browser permission acceptance and live-site verification are separate deployment
steps; synthetic tests do not establish the site's future ban behavior.

Verification for0.4.0 covers six synthetic command-store cases,17 controller
scenarios, and authenticated HTTP poll/ack authorization in the existing bridge
suite. The isolated unpacked-Chrome test pregrants the site permission only in its
disposable fixture, enables developer mode there, and exercises managed-tab start,
stop, and version-changing reload/receipt recovery without another extension action
click. This does not automate or claim the user's native permission consent.

Deployment status (2026-11-12): implementation and synthetic verification are
complete (bridge/controller suite, typecheck, formatting, and the full isolated
Chrome alarm/start/stop/reload test). Version0.4.0 is prepared in the ignored local
extension directory; the receiver responds HTTP200. No live control command was
enqueued. The user's native extension reload and optional permission grant are
still pending, so persistent permission and remote control in that profile are
not live-verified. The latest existing snapshot reports8 navigations and a future
rest alarm; an older10-navigation run remains paused. Neither snapshot was rewritten
by this deployment.

## Daily quiet hours — version0.4.1 (2026-11-12)

The user selected02:00–08:00 Asia/Seoul every day. Automatic monitor alarms falling
inside this interval are deferred to08:00 KST, independently of the Mac timezone.
The existing phase, queue and counters are preserved; a scheduled quiet interval
is not a manual stop or a security pause. Running work resumes from its saved
position when Chrome can deliver the alarm at/after08:00. A request already issued
before02:00 may finish; no new automatic navigation is started during the interval.
Overdue alarms and worker restoration apply the same policy before site access.
The adjusted `nextAt` is retained in local storage and the receiver snapshot without
creating a fictitious navigation event. The native badge/title shows quiet hours
when the controller runs in that interval.

Manual/security stops remain stopped. New start/resume commands during quiet
hours return `QUIET_HOURS_NO_START` before creating or navigating a managed tab;
manual starts also refuse to read a baseline until after08:00. No catch-up burst
or additional worker is added. The regular staged traversal and15–30 minute rest
between cycles continue outside quiet hours. Loopback-only control heartbeats
remain active so local stop and status commands work overnight.

Seven additional monitor cases cover exact KST boundaries, midnight-independent
conversion, cross-boundary scheduling, no overnight navigation,08:00 continuation,
restoration and stopped/security-state preservation. An additional control case
checks that a quiet-hours resume does not even create a site tab.

Deployment: the prepared extension was remotely reloaded during an observed idle
rest, and the owning Chrome instance acknowledged version0.4.1 (`RELOADED`). Its
persistent permission remains enabled. The live snapshot kept17 navigations and
the same next-cycle timestamp across reload; no collection navigation was added
by deployment. All10 Pokergosu test wrappers passed (monitor29 scenarios,
control18 scenarios plus bridge/browser/domain suites). Actual overnight passage
has not yet occurred; time-boundary behavior is verified with synthetic clocks.

## Always scan three list pages — version0.4.2 (2026-11-12)

The user authorized checking all three pages on each normal monitor cycle after
reviewing observed posting volume. The discovery stage now always visits pages1,
2 and3 before planning any thread reads, even when page1 already overlaps the
previous cycle's first-page IDs. This supersedes the earlier overlap-based early
exit. Source captures already insert all discovered IDs/URLs into the durable
queue; duplicate IDs across moving pages remain idempotent. Queueing a post does
not claim that its body or comments have been read.

`discoveryOverlap` accumulates matches across all three pages and survives worker
restoration. Once page3 succeeds, a missing prior boundary increments
`discoveryGaps` and records `lastGapAt`; these are also exposed in read-only log
reports and automatic JSONL run-state records. The initial baseline has no previous
boundary and does not assert a gap. This is a suspected discovery gap, not a count
of missing posts or a claim that scanning60 rows guarantees completeness. No fourth
page or unbounded scan is introduced. Failure or quiet hours can interrupt the
three-page stage using the existing stop/defer policy.

Normal cycle bounds remain10 navigations: three list pages, at most six threads,
and one return to page1. Thread navigation spacing remains30–45 seconds, rest
remains15–30 minutes after a completed cycle, and02:00–08:00 KST remains quiet.
The previously authorized newest-unread-first thread selection is unchanged.

Verification:30 synthetic monitor scenarios include first-cycle three-page scans,
no early exit on overlap, overlap retained from an earlier page across restore,
missing-boundary gap counting, request budgets and quiet hours. Backend tests
validate the new boolean and its persistence; existing audit/log suites pass.
The isolated native Chrome test reads pages1–3 before a thread, returns to the
board, and preserves local start/stop/reload receipts on a separate synthetic
receiver port18791, without interrupting the live receiver.

Deployment status: the receiver was refreshed after the active cycle returned to
rest; the owning Chrome instance acknowledged version0.4.2 with `RELOADED` and
continued heartbeating with its permission enabled. The existing run retained72
navigations and the same next alarm through reload. The three-page policy is live
for the next discovery stage; a complete real-site cycle under this version has
not yet been observed. Implementation, synthetic/browser tests and deployment are
complete, while that next live-cycle observation remains separate.

## Mention source page — /pokergosu (2026-11-12)

The user requested a `포커고수 여론` menu and page in Mention. The analysis menu now
links to `/pokergosu`, with `/pokergosu/:id` for retained post/comment evidence.
The page shows independent discovery/read/keyword-match/comment totals, last-check
metadata, collection-state records and discovery-gap cautions. It searches retained
post titles/bodies and comment text, filters exact matched include keywords and
last-checked dates in KST, and supports all collected posts or matched posts only.
Global cards remain explicitly separate from filtered list counts. Missing author
or publication time stays unknown. Keyword matches are not sentiment judgments:
all source posts remain `미분류` until a separate classification feature is authorized.

A narrow application reader port exposes list/detail DTOs. Its Node SQLite adapter
opens only `runtime/pokergosu/monitor.sqlite3` read-only with query_only and a short
consistent transaction, then closes it. It reads public-board rows and only the
monitor state allowlist; token files, control commands, credentials, private state,
legacy collector IPC and source website requests are not used. Routes expose GET
only. Runtime absence produces an explicit empty/unavailable state without creating
a database, logging in or starting any collector. Existing public/local origin
boundaries and no-store headers remain in place; the source data is public-board
evidence and appears through the existing authorized Mention tunnel as well.

The default list returns20 lightweight previews (maximum50). Numeric-ID keyset
pagination uses digit length and ID rather than lossy JavaScript number coercion;
a filter-bound cursor retains a highest-ID ceiling so newer arrivals do not shift
subsequent pages. SQL performs filtering, counting and page selection; only bounded
page payloads are decoded and comments/full bodies are excluded from list DTOs.
Summary and keyword SQL still scan retained rows and are not claimed incremental
or suitable for unlimited growth without measurement. Detail exposes a single full
body and the first100 retained comments, with an explicit limit notice when needed.
Media-only content, skipped/unavailable comments and incomplete coverage remain
visible; images are not requested or interpreted by the UI.

React SSR loads and dehydrates only the active source list or detail query. Hydration
reuses that data, and returning to a fresh cached list does not refetch it. Filters
live in the URL, pending form choices stay local, and page refresh reads the local
DB without refreshing Kakao analytics or visiting Pokergosu. There is no added
poller, daemon, classification worker or collector lifecycle change.

Page verification and deployment: all93 unit/contract tests passed, with relevant
source/design-system tests repeated after the shared table change. TypeScript,
Biome (one pre-existing informational lone-block notice), client/SSR builds and
all five synthetic browser tests passed. Tests cover source-only keyword matching,
KST filters, SQL input handling, no private-state disclosure, bounded previews,
scoped cursor rejection/new-arrival stability, absent source and read-only API,
useful SSR data, hydration, filter submission, keyboard/mobile scrolling, errors,
empty results, and media omissions. Desktop/mobile and retained detail screens
were visually inspected using both synthetic and live retained data.

The web process was updated with the documented lifecycle script; neither Kakao
nor the Pokergosu receiver/extension was restarted for this page. The earlier web
shutdown used its configured25-second drain deadline before cleanup, and the new
web process returned healthy. The existing tunnel `/pokergosu` returned HTTP200;
a nonexistent retained-post page returned404. Final live measurements (57 retained
posts at verification): list20 previews7,823 bytes /25ms; populated SSR49,033 bytes
/29ms; browser useful populated view954ms. Hydration made zero duplicate API reads;
opening detail and returning made one detail API request and reused the list.
There were no browser page errors, document overflow on390px mobile, or external
website requests. These local measurements are a small current-data sample, not
a general latency SLA. Aggregate-only verification artifacts remain ignored under
`runtime/pokergosu/`; no source posts or screenshots are committed.

## Metadata, retained image references and the longer interval — version0.4.4 (2026-11-12)

The user reported missing author/time fields, requested photos, then selected a
30–60 minute interval with a five-page maximum. These explicit requirements
supersede the earlier15–30 minute rest and mandatory three-page policy.

Monitor starts are now scheduled30–60 minutes apart, including the paced reading
work inside the interval. If an unusually delayed cycle already exceeded its next
nominal start, schedule another30 minutes from completion rather than issuing a
catch-up burst.02:00–08:00 KST quiet hours remain an explicit exception. A running
old-policy rest is migrated once using its retained cycle-start evidence; stopped
or security-paused runs remain untouched. `schedulePolicy: 2` and
`cycleStartedAt` preserve the rule across worker restoration.

List traversal stops upon encountering the previous discovery boundary, with a
maximum of five pages. The initial loaded baseline supplies a known boundary for
a new run, while later returns refresh it from the most recently inspected first
page. All discovered IDs remain durable and deduplicated. This boundary is distinct
from the last post whose body was read: unread discovered posts are not discarded
just because body processing lags. If page5 still has no prior boundary, retain a
discovery gap and timestamp. The budget is now12 navigations (five list pages,
six bodies, one return); body spacing remains30–45 seconds. The existing newest
unread-first six-body plan and historical72-hour eligibility window are unchanged.
Consequently, discovery and full-body completeness are still different metrics.

The site's visible header text was already retained separately, but its actual
markup did not match the original generic author/time selectors. `metadata.py`
recovers missing fields only from a unique, valid dated header and the exact post
link, or a complete retained comment header. It never infers them from body text,
never overwrites existing nonempty fields, and declines ambiguous/invalid evidence.
The browser reader additionally excludes content and child comments when selecting
structured author/time fields. The `metadata-repair` lifecycle command appends new
revisions with repair timestamps while preserving original revisions, checked_at,
keyword decisions, bodies and operational navigation history. Missing evidence
stays unknown. At deployment,56 of63 retained posts had author/publication fields;
the remaining seven were not guessed.

Body and comment images now retain separate ordered references (URL, alt text,
reported dimensions), including common lazy-source attributes and srcset fallbacks.
Header avatars are outside the content scopes. URLs are HTTPS without userinfo;
inline/blob/invalid references or the total100-reference limit produce explicit
`images_skipped` counts. The extension does not fetch image bytes or request new
host permissions. Existing text matching does not interpret image pixels or alt
text. Older captures without image URLs cannot be reconstructed from the retained
text; new references arrive on normal future captures/rechecks.

The viewer distinguishes references from files. A direct `이미지 불러오기` action
requests an image once and caches successful bytes under ignored local runtime;
viewing a page or an uncached-image GET does not fetch anything upstream. Requests
must identify an image already retained for that post and have the configured
local/public Origin. Only the board's four exact first-party image hostnames over
HTTPS443 are fetchable. Redirects are revalidated (maximum four requests), no cookies
or browser credentials are copied, and only PNG/JPEG/GIF/WebP/basic AVIF signatures
up to8MiB are stored. Other-host references remain inspectable via the source post.
One in-flight operation and per-URL receipts coalesce repeated clicks; failure
receipts are not automatically retried. An HTTP403/429 creates an image access hold,
preventing further image downloads. This is not a claim of an account ban and does
not bypass a challenge. A future operator decision is required to clear a hold.

Successful file bytes use atomic writes and private file modes. The media GET
serves only a validated hexadecimal cache key with a fixed raster MIME and nosniff;
it never starts a download. The URL-keyed first-loaded file is preserved rather
than fetched again on later page views. UI captions explicitly distinguish this
first-view file from the original capture time, since the source image may have
changed between those times. The source view still does not do OCR or automatic
sentiment interpretation. The design-system catalog includes synthetic cache-state
and image-sizing examples with no source requests.

Verification: all99 unit/contract tests passed, with24 affected wrappers/contracts
repeated after final metadata scoping and schedule-migration changes. They include
31 monitor scenarios,34 DOM extraction checks,10 receiver intake checks,five retained
metadata-repair cases and five image-cache contracts. The isolated native Chrome
alarm/capture/reload scenario passed. All six synthetic browser tests passed,
including explicit image loading, decoded cached PNG rendering, reload reuse and
zero browser requests to the source image host. Typecheck and Biome passed (the
existing informational lone-block notice remains).

Deployment: the receiver and extension were refreshed during a confirmed rest.
The owning Chrome acknowledged version0.4.4; visits remained102, status running/rest,
with the same next alarm at2026-11-12 19:38:55 KST. The prior cycle-to-next interval
was47.0 minutes after migration. No new run or extra website navigation was added.
The web was updated with the existing lifecycle script. Live retained-data checks
confirmed author/publication fields visible on desktop/mobile, healthy hydration,
no page errors or external requests, no mobile overflow, and HTTP200 through the
existing public tunnel. The first live-site photo-reference capture under this
version and a real upstream photo download are pending the normal scheduled cycle
and explicit viewer action, respectively; synthetic image success does not claim
that every source host or image format is downloadable.

A first live hydration probe timed out during the web rollout. After the final
coherent build/restart, the repeated live probe passed: retained author and time
were visible; API, detail page and public page returned200; hydration had no page
errors, failed requests, external requests or390px document overflow. The runtime
verification records contain aggregates only. No additional source-page read was
performed to backfill missing historical photo references.
