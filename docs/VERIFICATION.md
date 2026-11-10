# First-slice verification — 2026-11-06

## Scope

Local production-build preview at 127.0.0.1:8790, with existing legacy HTTP service
as its public monitoring source. Initially this was a local-only preview; the user subsequently requested the public switchover described below.
No legacy service restart, Kakao login, token move or production edit was performed.
The existing collector PID 53735 remained connected during verification.

## Automated checks

- TypeScript strict typecheck and Biome recommended lint/format checks.
- Fifteen Vitest tests: per-target classification semantics, unknown/stale handling,
  cursor traversal with tied timestamps, cursor/filter mismatch, capped DTOs,
  protected writes, origin checks, SSR content/query isolation and the adapter.
- Three Playwright integration tests: populated HTML without JavaScript,
  hydration with zero repeated initial API reads, native client route transitions,
  classification edit/cancel dialog, selected context, filters and mobile bounds.
- Client and server production builds complete.
- Dependency audit: zero reported info/low/moderate/high/critical vulnerabilities.
  Exact dependency versions and pnpm lockfile retained.

## Observed local warm snapshot measurements

| Route                          | Response time | Uncompressed body |
| ------------------------------ | ------------: | ----------------: |
| `/` populated SSR              |         79 ms |      54,909 bytes |
| `/api/overview`                |         16 ms |       2,713 bytes |
| `/api/conversations?limit=12`  |          4 ms |       5,503 bytes |
| `/reviews` populated SSR       |         46 ms |      50,399 bytes |
| `/conversations` populated SSR |         29 ms |      39,099 bytes |

Measured on the current Mac with warm, public-only adapter data. Native production
HTTP compression is enabled and was tested with decoded, nonempty HTML. Core
monitoring records were not copied into source fixtures. Screenshots and raw
measurement/audit output are development artifacts, not committed transcripts.

## Limits

- A cold first upstream read still takes seconds (one observed cold SSR about
  3.75 seconds). The adapter's 30-second shared public snapshot reduces repeated
  query work; it does not optimize the legacy DB grouping algorithm.
- Cursors limit new API/browser responses over the snapshot. They are not proof
  of cursor-limited SQL execution in the source service.
- The new app requests no private assistant data or local-only send operations.
- Classification corrections are tested with synthetic ports; the running preview
  blocks writes. Real edits are neither necessary nor claimed for verification.
- The other legacy management and delivery pages are not migrated.
- React Router's security-patch major exception requires ongoing navigation tests;
  a passing first slice is not proof of every future route/form combination.

## User-requested preview switchover

- Retired only the old Mention web process, gateway, AI preview and tunnel.
- Confirmed ports 8766, 8767 and 8776 are closed, with the new port 8790 open.
- Confirmed collector PID 53735 and its service identity are unchanged/connected.
- Replaced the HTTP read dependency with a read-only collector-socket bridge.
- New public overview/classification pages return current data with the old HTTP
  server stopped. Public origin validation for refresh was exercised successfully.
- All three browser integration tests also passed through the new Cloudflare URL,
  including JavaScript-disabled SSR, repeated navigation, context and mobile bounds.
- New preview remains read-only; full legacy feature parity remains incomplete.

## Subsequent full monitoring UI restoration — 2026-11-06

The read-only/four-screen statements above describe the initial slice. All
monitoring menus, source details and existing actions/exports are now connected
in the replacement. Monitoring edits are enabled in the deployed instance.
Current verification: strict typecheck, Biome, production build, 23 unit/contract
tests and 7 browser tests pass. Live read/download smoke and public-scope checks
passed; sends/settings writes in browser tests were intercepted. No real message
was sent, no user classification was edited, and no backup was created merely to
test the UI. Collector PID/service identity remained unchanged and monitoring.
See FEATURE-PARITY.md for the complete feature table and limits.

## Public read model and save headings — 2026-11-09

Implemented/deployed: durable public overview summaries and SQL-paged conversation
previews, single-flight background rebuilds, restart reuse, visible aggregation
time, sticky page form actions, distribution color legends, UTF-8-safe IPC and SSR
stream decoding. Only the new web process was restarted. Collector PID 63204 still
has the original November 6 start time; no Kakao restart/login or source DB write.

Strict typecheck, Biome, client/server build and 30 unit/contract tests passed.
New synthetic checks compare SQL projection outputs with the domain fallback for
days/targets/labels (including missing/stale evaluations), traverse tied cursors,
reject scope mismatches, reopen persisted data offline, roll back failed rebuilds,
and distinguish background single-flight from post-write refresh. Stream regressions
verify split Korean UTF-8 bytes and SSR form values without replacement/NUL chars,
including the reproduced production-renderer boundary failure.
No real settings or chat deliveries were used in browser mutation checks.
Final browser suite: all 7 tests passed, including no-JavaScript SSR, zero
initial hydration API duplicates, mobile routes, sticky save submission and an
intercepted guide save preserving every original keyword/reference. The separate
production-mode SSR boundary suite also passed all 5 checks.

Observed on the same local deployment (not a statistical benchmark):

| Measurement                                |                          Before |            After |
| ------------------------------------------ | ------------------------------: | ---------------: |
| First overview API after web restart       |                       26,545 ms |           3.6 ms |
| Conversation page API after restart        | not independently measured cold |           4.4 ms |
| First populated overview SSR after restart |        not measured in this run |           802 ms |
| Subsequent populated overview SSR          |                               — |            37 ms |
| Public Cloudflare overview API             |                               — | 949 ms, HTTP 200 |

The after-restart measurements use the durable projection created before web
cutover; this is process-cold, not a clean-install or cold-source rebuild claim.
The initial public-source rebuild still took 11,379 ms and is now outside normal
page requests. The API overview body was 4,441 bytes; list limit=12 was 6,235 bytes,
SSR was 35,066 bytes. Projection SQL EXPLAIN confirmed the day/time/ID index performs
keyset range lookup. Filtered API pages were also populated and capped. Raw timing
records and screenshots are in ignored runtime/, not source control.

Limits: full upstream insights grouping still runs for projection regeneration.
A clean installation without a projection must initialize it. Explicit refresh
waits for source computation; historical classifications, trends and briefing
still use the compatibility paths and have separate cold-read costs. Snapshot
aggregation time describes retained data, not proof of live connection or complete
history recovery. Incremental source processing remains future work.

## Shared aggregation producer — 2026-11-09

Implemented and deployed: one web-owned read-only analytics worker for insights,
trends, briefing and classification listing. It snapshots only explicit public
analytics tables and keyword settings, releases the source read transaction, and
uses the existing rule functions against a query-only in-memory DB. Operational
constructors/migrations, sends, token access and collector operations are absent.
Only the web process was restarted; collector PID 63204 retains its November 6
start time. The worker's input pipe closes with its owner and it has no listener.

Verification: 34 unit/contract tests pass. The new differential integration test
performs 24 synthetic comparisons/invariants against the original analytics,
classification tokens/history and briefing functions, including manual correction,
stale evidence, exclusions, saved briefing versions, tied room timestamps,
unchanged-room reuse, private-table changes and prohibited writes. Synthetic fixture
constructors are allowed only during fixture setup; guarded production read execution
never calls Store/Context/Coverage constructors. No production DB was copied to disk
or altered. The integration check requires a compatible legacy source directory and
is skipped if it is unavailable. Read-worker tests cover serialization, unchanged
write/local capability forwarding, child-only recovery/shutdown and duplicate-read
coalescing. The existing browser suite also passed all 7 tests with the new reader.

Observed local API results on the same live deployment (single observations,
not statistical guarantees):

| Read                |    Before |    After |
| ------------------- | --------: | -------: |
| Trends              | 10,304 ms |   975 ms |
| Briefing            | 30,490 ms |   969 ms |
| Classification page | 24,368 ms | 2,154 ms |

The first trends request after restarting the new worker took 5,226 ms while the
initial shared grouping was built. Its first grouping calculated 1,568 episode
details in 3,358 ms plus snapshot/preparation/IPC overhead. A subsequent live change
recomputed only 31 details in the affected room. Original response sizes remained
unchanged (trends 63,519 bytes, briefing 12,802, classification page 9,749); this is
not a fast empty response. Source read transactions were observed around 128–152 ms.
The first complete browser suite fell from about 1.7 minutes in the preceding
verification to 18.8 seconds, with the same populated routes and intercepted writes.

An additional filesystem-version fast path skips the public snapshot scan when DB,
WAL/journal and audit versions are unchanged and a matching result is retained.
It uses device/inode/size/nanosecond mtime/ctime, rejects the fast path while a source
journal exists, and only records a version that was stable across the source read.
Private-table writes invalidate that hint, but unchanged public fingerprints still
reuse aggregates. Korean date and query parameters remain in result keys; briefing
image availability is rechecked independently. Result/detail/room/group cache sizes
are bounded. This does not introduce polling of Kakao servers.

Limits: first-generation computation still takes seconds. Changed source files
require public-table scanning/fingerprinting, and changed rooms can rebuild their
historical candidates. Source mutations/save/send/image commands remain on the
collector and retain its computation cost and authoritative receipts. No per-row
change stream or production schema/index change has been implemented.

Final fast-path observations after deployment: unchanged trends 4.8 ms and briefing
2.6 ms locally; first trends after worker restart 5,403 ms. Public Cloudflare reads
returned populated HTTP 200 responses in 982 ms (trends) and 293 ms (briefing).
An invalid date returned HTTP 400. Final browser rerun passed all 7 tests in 21.4
seconds. Collector read status remained monitoring with PID 63204 unchanged; exactly
one web-owned analytics child was present. Sanitized timings are retained in ignored
runtime/aggregation-performance.json.

## Alias targets and promotion filtering — 2026-11-09

Implemented: visible proposed targets, explicit manual selection for unresolved
candidates, separately folded weak/unresolved expressions and evidence, target
labels on processed decisions, minute-based precomputation and 12-item pages.
No keyword was added/dismissed or monitoring data removed merely for testing.
Read-only production computation excluded 563 promotion/announcement records from
3,533 initially eligible retained records; 2,970 nonexcluded records remained.
This is heuristic suggestion filtering, not a guarantee of semantic alias identity.
A first generation took 4.16 seconds outside page serving. A populated aliases SSR
page loaded in a browser in 191 ms in one local observation; mobile had no document
overflow. Screenshots remain in ignored runtime/.

Checks: 37 unit/contract tests passed; the alias evidence check uses only synthetic
messages and verifies exclusion of promotional templates, URL/digit variants and
schedule ads, preservation of real price/opinion questions (including questions
about promotional announcements), known target attribution and original collector
eligibility. Projection tests cover persisted/offline reads, capped pages, mutation
scope and refresh ordering. Eight browser tests passed, including intercepted alias
addition after an explicit ambiguous-target selection and folded cooccurrence UI.
Real alias decisions were not submitted in these checks. Collector lifecycle and
all responder/private worker schedules remain unchanged.

## Already recognized alias derivatives — 2026-11-09

Audited the retained suggestion set against the actual configured keyword matcher:
33 suggestions were already recognized, including apl줌/apl티켓, 개츠비님/개츠비로,
and 룰루야. The suggestion adapter now excludes recognized tokens using the same
monitor.rules.matches function and current keyword settings. It changes suggestion
eligibility only, preserving source records, configured keywords and decisions.

New synthetic regressions cover 11 recognized derivatives (including full-width
APL, attached phrases and numbers), four unrecognized/new spellings, and the real
original-discovery failure for "Kk 대회권 apl줌?". The latter was reproduced before
filtering and disappears after it, while ap1 remains available. An older version-1
persisted suggestion file is rebuilt instead of replaying incorrect cached candidates.

## Context collections and fixed workflow menus — 2026-11-09

Implemented/deployed: latest activity, confirmed positive context and confirmed
negative context collections, current per-target opinion summaries, source excerpts,
explicit summary-pending states and origin-preserving review/context navigation.
No new AI summary job or classification write was submitted; existing confirmed
assessments are reused. The live data initially supplied one eligible positive
example and no eligible negative example, so the negative collection honestly
shows an empty state. These are availability limits, not an absence-of-opinion claim.

41 unit/contract checks passed. New coverage verifies latest activity ordering,
stance/target isolation, stale exclusion, dual stances for different targets, date
scope, bounded collections and menu-origin validation. The source differential test
also checks each preview's native ID, text prefix, speaker and timestamp against
synthetic source rows. Browser checks exercise direct/no-JS SSR, the three sections,
mobile bounds, review-to-context and context-to-review origin preservation, reload,
and explicit menu changes. Review-dialog tests wait for source rows before checking
staleness, since live evidence can legitimately change between earlier runs.
Screenshots and prepared timing artifacts remain under ignored runtime/.

Direct context correction: 41 unit/contract tests and TypeScript passed. A browser test intercepted the save request, verified conversation ID, conflict token and request ID, and confirmed no navigation. The public reported conversation opened the APL correction dialog on desktop and mobile without navigation or horizontal overflow. No production classification was changed during verification.

## Design-system foundation (2026-11-09)

Implemented semantic CSS tokens, an SSR-shared provider, project-owned Button/Card
defaults, named Radix control exports and PageHeader/Section/FilterBar/Field/
DialogContent patterns. All existing feature control imports use the boundary.
Added an interactive synthetic catalog and mandatory project/development rules.
43 unit/contract checks, strict TypeScript and Biome pass. Browser checks covered
SSR, hydration, management form association and sticky saves, mobile pages,
correction requests and catalog keyboard/dialog behavior. The previous navigation
test was updated to use a classified conversation instead of a moving live latest
record, and to assert background navigation after modal dismissal (Radix correctly
hides background content from accessibility queries while a modal is open).

Public catalog, overview and keyword management returned 200 without browser
errors or mobile horizontal overflow. The catalog is populated with JavaScript
disabled. Mobile keyword save remains aligned to the right. Verification used
intercepted writes only; no production settings/classifications were changed.
Web-only deployment; no collector lifecycle changes. Older local feature spacing
remains and is documented in the adoption status rather than claimed complete.

Conversation reader decluttering: strict TypeScript, Biome and 43 unit checks pass. Browser checks verify in-place correction, menu origin, shared design catalog, boundary-positioned expansion with intercepted before/after payloads, and the mobile reaction anchor. Public desktop/mobile screenshots inspected; no horizontal overflow. No real context expansion or classification writes were performed.

Historical classification display: 44 unit/contract tests pass. Stale results retain their prior label and origin as optional presentation metadata while effective labels remain unreviewed and excluded from confirmed sentiment aggregates. Snapshot enrichment occurs on a copied insights result only; collector conflict-token evaluations and classification contracts remain unchanged. Synthetic parity checks compare original evaluations and correction tokens. Public detail showed three prior neutral decisions and review showed six recheck cases. No production labels were changed.

Room configuration: included/excluded pages load independently (25 per page) with separate URL page keys and shared room-name search. Reporting dates/unrelated filters are not forwarded. 45 unit/contract checks pass. Browser checks exercise mobile boundaries and synthetic-only room moves in both directions, plus failure selection retention. Public selection-only checks verified right-aligned action and removed reporting date; no production room setting was submitted.

Overview readability refinement: desktop and mobile full-page screenshots inspected before/after; summary values and links no longer run together, target-row links occupy a separate line, conversation excerpts are collapsed by default, and positive/negative examples use flat rows. Final public mobile capture has no document horizontal overflow; the target table scrolls internally at a readable width. Four browser checks passed for no-JS SSR, filter/count scope, context sections and design catalog, plus hydration navigation. No source selection or sentiment policy changes.

Inline classification: 46 unit/contract checks pass, including synthetic first-decision audit, optional empty memo, correction conflicts, replay and uncertain result non-resend. Four browser checks passed for hydration/navigation, filters, menu origin, and inline selection plus separate optional memo; writes were intercepted and no production classification was changed. Existing long-label review links were shortened and kept alongside their counts.

List classification and observation origin: 47 unit/contract checks passed, including source-token parity, indexed versus fallback status-filter parity and comparison-origin isolation. Five browser checks passed for SSR, mobile restored views, unchanged uncertain-delivery request reuse, separate memo behavior and classification directly in the list without per-row detail requests. Writes were intercepted; no production classifications, room settings or sends were performed. Read-only live comparison check showed 0 dashboard-origin, 90 external automation and 6 legacy unknown-source observations; initial comparison selection is empty.

Judgment exclusions: 49 unit/contract checks pass, including separate storage with no unsupported collector writes, replay and stale-token rejection, indexed exclusion/pending scope, audit preservation, restoration and persistence across reader replacement. Four browser checks passed for filters, optional memo, list classification and the direct judgment-exclusion choice. All browser writes were intercepted; no production label was changed during verification. Web-only rollout; collector connection preserved.

Excluded-room campaign leakage: a synthetic confirmed-send anchor in an excluded room is preserved in operational source storage but absent from public insights. Differential analytics checks now compare legacy business calculations over independently scoped fixture copies, preserving correction-token parity and read-only source guarantees (25 inner checks). Live public read-model query confirmed zero conversations for the excluded MyPokerTrips room. Three browser checks passed for overview contexts, filters and inline classification. No collector restart or production history deletion.

Context expansion completion: 50 unit/contract checks pass. Browser verification uses intercepted responses to confirm a finished previous lookup hides only its own button, waiting-for-messages retains the next button, and terminal completion then hides it. No real history request was made for this UI check.

Keyword editor alignment: included/excluded textareas both use12 rows. Public desktop/mobile screenshots inspected, including an expanded group. A browser check verifies equal input dimensions, collapsed group overview, edited group name and preservation of every closed group type in an intercepted save, with no mobile document overflow. Existing management-save and design catalog checks also passed. No production keyword setting was changed by verification.
