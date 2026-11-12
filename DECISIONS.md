# Decisions

Recorded 2026-11-06. This is an existing-service replacement, not authorization to
rebuild all infrastructure or replace a running Kakao session.

| Decision         | Status / rationale                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | User-approved: `/Users/we/mention`; legacy project preserved.                                                                                                                                      |
| Rendering        | User-required SSR. The guide's React/Vite CSR default is an explicit exception here; React SSR does not require Next.js.                                                                           |
| Frontend         | Implemented: React 18.3.1, TypeScript 5.9.3, Vite 8.3.6 and TanStack Query 5.106.1; exact versions locked after dependency checks.                                                                 |
| SSR integration  | Implemented and verified: renderToReadableStream, StaticRouter and hydrateRoot on the same React tree. No Next.js or DOM snapshot/replay renderer.                                                 |
| UI               | Implemented: Radix Themes 3.3.0 (MIT), a pre-styled component system covering the first slice. Product-specific layout only; standard controls are library components.                             |
| Data fetching    | TanStack Query baseline; URL owns filters, local state owns local UI, Zustand only for real cross-page UI needs. No default API prefetch/polling/focus refetch without a recorded monitoring need. |
| API shape        | Separate summary, paginated list and detail contracts. Cursor pagination happens at the query boundary, not after returning/computing the complete dataset.                                        |
| Existing backend | Retain the sole Python collector and existing SQLite data. A deliberate exception to adopting the guide's new-project NestJS/PostgreSQL stack wholesale.                                           |
| Classification   | AI results publish as AI-origin confirmed classifications. Review page edits confirmed labels and notes; preserve human corrections, evidence guards and audit history.                            |
| Dates            | Preserve explicit Asia/Seoul display and filtering semantics; document conversion/storage boundaries.                                                                                              |
| Operations       | No collector restart/login, private-worker changes, token moves or production cutover as part of setup.                                                                                            |
| Performance      | Evaluate fully useful data arrival, query work, bytes and navigation. Skeleton timing alone is insufficient.                                                                                       |

## Explicitly not decided by the guide link

A new database engine, backend language, cloud platform, authentication rollout,
new Kakao identity, or a new background AI worker is outside this setup. Existing
SSR requirements are not silently changed to CSR. Any changed product requirement
must be recorded with its actual authorization, not inferred from a template.

## Evidence before locking the build

1. Compatible SSR entry, route lazy loading and hydration with no duplicate data read.
2. Request-scoped server state and public/local cache isolation.
3. Real selected UI components with a mobile and desktop sample.
4. Lightweight summary/list/detail contracts and measured source-query cost.
5. Version/security/license checks, reproducible lockfile and lifecycle script.

## Version and integration exceptions verified during implementation

- React 18.3.1 retains the guide's React 18 generation with a compatible patch line.
- Vite 8.3.6/plugin-react 6.2.1 use the current installed toolchain, matching Node
  support and dependency audit; no manual vendor chunks or eager route preload.
- React Router 6.30.6 produced security advisories; Router 7.18.5 is the patched
  compatible release selected for the new implementation. No v7 future flags are
  enabled. Repeated page transitions and dialog navigation are browser-tested.
- Zod 3 produced a high-severity advisory; Zod 4.6.7 is used for contracts instead.
- Patched Fastify middleware/static/compression packages are locked. The final
  dependency audit has no reported advisories. Reports are under ignored runtime/.
- Radix Themes replaces the earlier shadcn/Tailwind candidate: actual pre-styled
  controls were preferable to authoring another UI system for the first slice.
- The standalone web uses Fastify/Pino for HTTP and structured logs. No NestJS,
  database replacement or new collector has been introduced.
- Standard React SSR integration is verified. Exact dependencies and lockfile are
  authoritative for this implementation; the reference guide is not copied blindly.

## Current rollout

All monitoring routes are deployed with native React SSR and monitoring edits
enabled in the active instance. Local delivery/backup restrictions are preserved.
The initial four-view read-only slice is superseded by the restoration described
below. Cold source-query costs remain; see docs/FEATURE-PARITY.md.

## Monitoring parity restoration (2026-11-06)

The user explicitly required preserving every existing monitoring feature in the
replacement. All monitoring routes now have native React views; the collector
retains domain validation, writes, receipts and ownership. A narrow WorkspacePort
adapts the existing public/local endpoints and binary assets. Private assistant,
poster-worker and lifecycle endpoints are not exposed by this port.

Monitoring writes are now enabled in the active deployment. Local delivery and
backup actions require a local request and local origin; forwarded/Cloudflare
requests cannot upgrade themselves by spoofing Origin. Default source configuration
remains read-only. Mutation retries remain disabled, and classification writes
serialize the existing evidence check/audit sequence across bridge processes.

The monitoring-specific automatic refresh is preserved only for the active views:
messages/guide every 5 seconds, campaigns/overview every 15 seconds, rooms every
minute. Historical message pages and other management views do not poll. Form
editing pauses workspace polling. This is an explicit monitoring requirement, not
a new global fetch default.

## Read projection and fixed page actions (2026-11-09)

User requested removing the whole-dataset dependency from page loading. A separate
rebuildable public SQLite read model is now permitted under ignored runtime/;
the operational collector DB and Kakao lifecycle remain unchanged. Built-in
`node:sqlite` uses the already required Node runtime and adds no package dependency.
The first implementation materializes overview summaries and SQL-pages conversations.
It does not claim incremental source grouping or optimized briefing/trend queries.

User also requested page save actions at the upper right. A shared SSR-safe sticky
heading associates buttons with their original forms and preserves local-only and
read-only restrictions. List-item editors keep their individual action scope.

React 18.3.1's production Node renderer was independently reproduced inserting NUL
padding at UTF-8 buffer boundaries, corrupting textarea values on HTML parsing.
The server now uses React's Web Streams SSR renderer (`react-dom/server.browser`)
on the existing Node runtime, with allReady/error/timeout handling and normal
hydrateRoot. This remains the same React SSR tree; it does not execute a second
client DOM. A production-mode boundary regression and intercepted guide save
verify preservation of the original Korean form values.

## Aggregation producer optimization (2026-11-09)

The user explicitly requested further aggregation-speed improvement. The earlier
no-source-SQLite read boundary is superseded for a narrow read-only analytics
adapter. `projection_source.py` copies only allowlisted public monitoring tables
and keyword-related settings using a short consistent read transaction, closes
the source connection, then evaluates unchanged existing read rules in a separate
in-memory query-only DB. No operational constructor/migration/collector login is
run. All operational DB writes and delivery receipts remain owned by the collector.

A single stdin/stdout Python read worker is owned and terminated by the web process;
it is not an AI/responder worker or another collector. Public content fingerprints
and room-level caches prevent full regrouping for unchanged data/rooms. Immutable
read consumers share a grouped dataset across overview/trend/briefing/classifier
listing. Cache limits and Korean-date/audit/keyword dependencies are explicit.
Mutations, media, campaigns, private capabilities and schedules stay on the existing
socket adapter. Integration tests compare original functions against this adapter
on synthetic state and require the compatible legacy source via deployment config
or MENTION_LEGACY_ROOT. A pure source-code dependency is retained rather than
forking product classification/grouping rules into a second implementation.

## Alias suggestion evidence (2026-11-09)

User required showing which target a suggested alias belongs to and excluding
promotion/template evidence. The alias read adapter now filters that evidence
before discovery while retaining compatibility with the live collector's existing
addition eligibility/audit. Unresolved targets require explicit selection; weak
cooccurrences and unresolved expressions are folded separately. Default 14-day
suggestions are precomputed once a minute and persisted privately as a rebuildable
read model, with 12 candidates per page. This policy does not reclassify sentiment,
delete source messages, or change any existing keyword/guide setting automatically.

## Required project design system (2026-11-09)

All UI work must actively reuse the Mention design system. Radix remains the
accessible control implementation; project tokens, action intent and reusable
layout patterns live in `apps/web/src/design-system`. Feature code imports from
this boundary. Shared decisions are changed centrally rather than by page-specific
overrides. The synthetic `/design-system` catalog is available under management.
See `docs/DESIGN-SYSTEM.md` and the matching AGENTS.md requirement. Existing feature
layouts migrate when touched; the foundation is not a claim of a completed visual
redesign of every screen.

## Pokergosu public monitoring (2026-11-10)

The user authorized an independent program in this workspace to monitor Pokergosu
free-board posts and comments using the project's include keywords, with a random
15–30 minute cycle interval. This supersedes the no-new-collector setup boundary
only for this separate public-site collector; the sole Kakao collector remains
unchanged. Existing include matching policy is reused through a read-only
settings adapter. The user subsequently required ignoring exclusion keywords for
Pokergosu; they are neither read nor applied, and Kakao settings remain intact. Site records and revision history live only under ignored
runtime/pokergosu, independently of Kakao IDs, classifications and source DBs.
The implementation uses the installed browser/test library and Python SQLite,
without adding an unrelated backend stack or UI. Actual board access is currently
restricted and collection is paused; live selectors and populated-data performance
are not verified. See docs/POKERGOSU.md for scope and lifecycle.

## Continuous AI sentiment review (2026-11-10)

The user authorized reviewing the remaining PokerLulu backlog and future arrivals.
One dedicated local model session is queued by its own minute timer after a
120-second quiet window. Every decision requires retained source quotes, an
expected evidence token and durable request identity. Human decisions win; stale
AI context is reconsidered. Informational questions, personal play results and
promotion without service feedback are excluded with specific reasons. Unknown
writes are held and reconciled from receipts, never blindly retried. This queue
cannot control Kakao, send chats or change other workers. See the classifier doc.

Public grouped projections use the same room and KST anchor-date boundary as
native conversation detail. A cross-midnight global grouping produced different
canonical IDs/signatures and made saved classifications look unreviewed; the read
adapter now partitions by that boundary without changing source records or Kakao.

The user subsequently extended this queue to all remaining target keywords and
future arrivals. Private config `target: "*"` discovers target evaluations and
processes one target per batch, preserving independent decisions and human priority.

## Manual Pokergosu Chrome extension trial (2026-11-11)

The user authorized building and trying a private, unpacked Chrome extension.
The first trial uses activeTab/scripting on an explicit user click, with Chrome's
native action/menu/badge UI. There is no Web Store publishing, website navigation,
periodic alarm or cookie access. A token-authenticated 127.0.0.1:8791 receiver is
managed by scripts/pokergosu.sh and shares the headless collector's singleton
lock. It reads only authoritative include keywords, saves public observations in
the independent existing Pokergosu runtime DB, and records unknown markup as
bounded structural evidence. Real Chrome installation/action/loopback transport
passed using an isolated profile and synthetic pages; user-browser live content
and unattended collection remain unverified. Kakao and the deployed web process
are unchanged. See docs/POKERGOSU.md.

## Fifteen-check Pokergosu trial (2026-11-11)

The user authorized fifteen checks only to observe access restrictions, keeping
the previously agreed random15–30minute cadence. Version0.2 adds optional Chrome
alarms for a bounded board-list-only trial in the user-selected activeTab. This
supersedes the earlier no-alarm prototype limit only after the explicit trial
menu action. Each slot is persisted before reload; fifteen successes end the run,
and any failure/ambiguity stops without automatic retry. A loopback audit retains
attempt history and rejects counter regression or terminal-run reactivation.
This is not authorization for an indefinite poller, another Kakao collector,
proxy rotation or challenge solving. See docs/POKERGOSU.md.

## Conversation filters and editable evaluation notes (2026-11-11)

Classification status and sentiment now live in the same header filter bar as
date and target. Mutually exclusive status/sentiment choices clear the conflicting
filter rather than returning a misleading empty list. Embedded lists retain their
compact filter controls. Reset includes status and sentiment selections.

Direct classification remains immediate. The optional memo editor can be opened
before classification or during recheck, select a verdict and save the note in
one request. It retains the expected token captured when editing began, so a
background refresh cannot silently rebase an old draft over newer evidence.
The legacy episode evaluation form now includes its own editable evaluation note;
source persistence preserves omitted notes and records verdict/note edit history.
These are source-episode notes, distinct from grouped target-classification notes.

## Automatic Pokergosu post/comment monitor (2026-11-11)

The user stopped the finite trial after four successful list checks and then
explicitly approved implementing post/comment collection without per-post physical
clicks. A separate monitor uses the same temporary activeTab grant and dedicated
browser tab, with one page navigation per alarm. Its cycle is bounded to three list
pages and six thread reads, followed by a return to the list and random15–30minute
rest. Page gaps are30–45seconds. It revisits recent unmatched threads to capture
comment-only mentions, applies include-only matching and preserves source revisions.
Paused/unknown access is never silently retried. The old trial audit stays stopped.
The local receiver validates queue destinations and immutable navigation events;
unknown structured author/time metadata remains flagged, with bounded header
source evidence retained separately from matching text. No OS startup daemon or
Kakao worker change is authorized by this implementation. Live operation requires
one extension update/start and remains distinct from synthetic native-Chrome checks.

## Pokergosu operational access logging (2026-11-11)

The user requested logs identifying collection progress, verification prompts,
access restriction and the visit count at first failure. Canonical SQLite audit
records now have an automatically appended private JSONL projection and a read-only
report command. A new optional DOM evidence field records only bounded titles and
indicator labels. Bot verification, explicit access refusal, rate limiting,
account-restriction notices, parser/local errors and user stops remain separate;
neither HTTP status nor an account ban is inferred from unobserved state. Legacy
generic restrictions retain their uncertainty. The running receiver was refreshed
only during a resting window; exact browser-side distinctions require the prepared
extension update. Logging does not add another website worker or change Kakao.

## Continue past unreadable comments (2026-11-12)

The user explicitly required skipping uninterpretable comments after identifying
an image-only comment as the prior halt cause. Version0.3.2 retains media-only IDs
with empty text and no OCR/classification, records individual skip reasons, and
allows partial/unknown comment coverage with accurate counts. This supersedes
comment-level hard stops, not access/post/source/transport guards. Per-page audit
summaries retain omissions without claiming complete interpretation. The previous
paused run is not resumed by deployment.

## Template alignment extension (2026-11-12)

The user authorized the audit, stability, verification and release preparation
while excluding rate limiting from this pass. Keep the existing SSR/Radix/Python/
SQLite decisions; no server-stack migration is authorized by that discussion.
Web-only shutdown drains accepted requests and jobs before closing dependencies.
Production errors retain metadata in a separate private web diagnostics DB.
Pinned dayjs UTC/timezone helpers preserve UTC epoch contracts and explicit KST
reporting boundaries. No operational source timestamp conversion is performed.

Hermetic browser tests are the default CI suite; the broader operator integration
suite remains available explicitly. CI exports one immutable web image; container
promotion consumes it without rebuild, login or Kakao lifecycle operations.
The existing managed Mac/tunnel deployment remains active. Docker is not installed
locally; container source integration and production cutover remain separate,
unexecuted deployment steps. See docs/TEMPLATE-MATRIX.md and docs/RELEASE.md.

## Optional persistent Pokergosu permission and local commands (2026-11-12)

The user authorized one native Chrome site-permission grant to remove repeated
physical start clicks. Version0.4.0 adds only an optional Pokergosu origin and an
authenticated loopback command channel. Grant alone does not start collection.
Local start/resume/stop/reload commands use durable leases and execution receipts;
manual stops supersede older starts, ambiguous execution is never replayed, and
access-security holds reject automatic resumption. Chrome and the receiver must
already be running. No Kakao lifecycle or worker changes are part of this work.
No new live collection command is enqueued by preparation or testing; existing
run snapshots remain intact.

## Pokergosu daily quiet hours (2026-11-12)

The user explicitly selected02:00–08:00 KST. Version0.4.1 defers running monitor
alarms across that interval, preserves their work position, and continues at/after
08:00 while retaining manual and security stops. The policy uses a fixed Korea
UTC+9 clock, applies on restore and immediately before navigation, and is recorded
in the next scheduled timestamp. Overnight new start/resume requests are refused
before any site tab navigation. No OS startup action, extra worker, or Kakao change
is included.

## Affiliated-person target sentiment (2026-11-12)

The user clarified that praise of people configured under SENT counts as positive
SENT sentiment, including personality, appearance, skill and fandom. The former
classifier requirement for an independent service evaluation is superseded.
Apply sentiment to the configured parent while retaining the person-specific
reason; mere mentions and informational questions are not sentiment. Preserve
human edits and recheck AI exclusions against complete evidence rather than
mass-changing labels. See docs/SENTIMENT-CLASSIFIER.md.

## Pokergosu three-page discovery on every cycle (2026-11-12)

The user authorized always checking the first three list pages rather than ending
discovery as soon as a prior-page overlap appears. Keep discovered IDs durable,
remember overlap across pages, and report a suspected gap when no prior boundary
is reached after page3. Retain the10-navigation budget, six-thread maximum,
15–30 minute cycle rest,02:00–08:00 KST quiet policy and security stops. This does
not authorize an unbounded historical crawl or a fourth page. It changes neither
the newest-first thread policy nor the distinction between discovered and read.

## Pokergosu opinion page (2026-11-12)

The user requested a dedicated Mention menu/page. `/pokergosu` and its post details
read the existing independent public-board DB through a narrow read-only adapter;
no new source requests or collector/Kakao lifecycle operations are authorized by
viewing it. Summary/list/detail contracts, numeric keyset paging and route-specific
SSR keep populated views bounded and hydrated without a duplicate initial read.
Source keyword matching remains distinct from sentiment: posts are unclassified,
not automatically neutral. Missing metadata, media omissions and discovery gaps
stay visible. The existing design system owns all controls and the new shared
ReadingTable layout; the catalog uses synthetic evidence only.

## Longer Pokergosu interval, metadata recovery and image retention (2026-11-12)

The user's later explicit selection is30–60 minutes between monitor starts and
at most five list pages, stopping early upon reaching the prior discovery boundary.
It supersedes mandatory three-page traversal. Preserve discovered unread IDs, the
six-body bound, quiet hours and security/manual stops; log unresolved boundaries
rather than extending into an unbounded crawl. Existing-rest migration changes the
next alarm without starting another run.

Author/time recovery uses retained visible-header evidence, preserves existing
fields and capture times, and adds revisions instead of rewriting audit history.
Image references are automatically retained inside body/comment scopes on future
reads, while file downloads require an explicit viewer action and are cached.
This deliberately minimizes additional source traffic; it is not automatic photo
archiving at capture time. Keep first-party host/MIME/size bounds, no credential
forwarding, no automatic retries after failure, and an HTTP403/429 image-download
hold. No OCR, sentiment worker, Kakao session or unrelated schedule is changed.
