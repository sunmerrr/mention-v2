# Forum and keyword migration checkpoint

## Implemented

The preserved UI now includes the current combined-opinion, forum, grouped source
keyword controls and design-system components. Existing mobile table behavior is
retained. All product requests use the company monitoring API prefix; media links
use that prefix too. Refresh invalidates completed-view queries and never asks a
collector/aggregate worker to run.

PostgreSQL canonical models now store forum detail/cards, guarded human/AI reviews,
append-only changes, original review receipts and completed opinion summaries.
Native IDs retain exact19-digit identity through numeric ordering; filters and
cursor ceilings stay scoped and do not admit newly arrived posts into an older
page sequence. Literal search characters remain SQL parameters.

Keyword configuration has a PostgreSQL version/token guard and independent source
scopes. A save atomically writes the revision plus a durable keyword-reindex job;
it does not propagate settings to the host owner or Chrome. The Node forum reindex
consumer is implemented; the Kakao phase and complete raw-to-analysis pipeline
are still pending. A completed forum phase does not mark the shared keyword job
complete or misrepresent the unfinished Kakao phase.

Node forum aggregation runs only in the worker role under its own PostgreSQL
producer lease. Requests read prepared opinions; SSR never iterates the forum
corpus. Image requests enqueue bounded, idempotent cache work for that worker;
reads serve saved bytes from PostgreSQL. Source URLs must belong to approved board
hosts. Byte signatures restrict cached media to PNG/JPEG/GIF/WebP/AVIF. No SVG/HTML
is served as an image. Original cached media is imported rather than downloaded
from the external website again during migration.

## Populated validation

- Private import:177 forum post DTOs,47 common aliases,6 original review audit
  records,2 durable review receipts and1 previously cached image. DTOs preserve
  the original UI's bounded comment representation; full legacy raw source/command
  history still needs separate migration and is not claimed by these counts.
- Source-reference comparison uses the original ForumOpinions implementation on
  an isolated in-memory copy of original review rows. All177 saved post DTOs and
  9 date/target opinion scopes matched, with zero differences.
- A real one-shot worker completed using PostgreSQL evidence with the legacy URL
  deliberately unreachable. No Kakao/Chrome process was restarted or activated.
- Read-only staging browser QA: overview, combined, forum summary, post list,
  keywords, conversations and reviews at1440px and390px (14 checks). All returned
  200, hydrated and had no document overflow or browser JavaScript errors.
- Actual `pnpm verify:full` passed in84seconds:34 API unit tests and36 integration
  tests, common Docker image, both Compose definitions and transport checks.
  Logs and screenshots remain private under .dev/tmp.

## Still required before public cutover

Complete Kakao keyword-job consumption, context quotas and
DB-only expansion, remaining workspace/exports/briefings, native dialogue/schedule
migration, preserved historical state/cursor delta and complete page/action QA.
The seven-page read-only check is not a claim that every original feature has
already moved. The production shared link still uses /Users/we/mention. The
existing Chrome receiver/profile and native Kakao connection remain unchanged.

## Durable raw-processing checkpoint

The Node worker now consumes accepted forum inbox records transactionally. Raw
acceptance, canonical article/card updates, matched status and processing checkpoints
remain separate. Superseded captures stay retained without replacing newer cards.
Durable inbox sequence orders multiple collectors; client timestamps do not decide
which evidence wins. The public DTO keeps its100-comment bound while the raw inbox
retains all captured comments and full-text matching includes them.

Human classifications and notes survive changed or temporarily removed targets.
Changed evidence marks those reviews stale and invalidates the guarded edit token.
Removed target reviews remain in a dedicated retained table rather than being lost.
The common worker role processes bounded batches before publishing forum opinions.
No new Chrome profile/receiver or production worker has been activated by this code.

Forum list, opinion aggregation and review writes now use compact card/evaluation
columns instead of reading or rewriting article/comment JSON. After the populated
backfill,177 saved DTOs and9 opinion scopes still matched the original reference.

## Full legacy forum archive

The explicit `import-forum-archive` role accepts a bounded JSONL snapshot with
table counts. Rows are retained inertly in the shared PostgreSQL migration archive;
this does not import commands into an executable queue. Original unknown/sending
states cannot trigger a retry from archival import. The source exporter uses a
read-only SQLite transaction and is a one-off migration tool, not a server role.

Actual snapshot at2026-11-13T10:20:43Z:2579 rows across1457 thread records,
259 revisions,646 state records,2 read errors,133 search provenance records,
20 commands,60 control events,1 heartbeat and1 owner record. Full record comparison
against PostgreSQL found zero missing rows. This later snapshot includes189
collected payloads; it does not claim the earlier177-card public snapshot is live
current. Final canonical catch-up and current command ownership reconciliation
remain cutover gates. Files, hashes and detailed parity reports stay private.

## Resumable Node reindex and populated catch-up

The archive importer strictly validates original collected thread payloads into a
dedicated PostgreSQL source table. All189 collected payloads in the frozen snapshot
validated. Raw comments remain available beyond the100-comment presentation bound.
Import cannot replace newer live inbox-owned source records.

The worker processes keyword revisions in bounded transactions and stores its
cursor and forum phase in PostgreSQL. A fresh worker resumes that cursor; older
revisions become superseded. Missing source evidence blocks completion rather than
claiming a successful reindex. The forum status endpoint reports its own phase;
the shared job stays pending until the separate Kakao processor completes.
Completed opinion materialization is retained while a forum reindex is unfinished.
Forum summaries are also rebuilt by the worker from canonical cards and retained
discovery identities, never by SSR requests.

Actual isolated catch-up processed189 raw payloads with the legacy API deliberately
unreachable. Comparison against the original Python keyword rules found zero
differences across matched state, aliases, comment counts and observation time.
Full validation passed:39 unit tests,43 PostgreSQL/API integration tests, Docker
build and Compose checks. No host settings, Chrome profile, Kakao authentication,
production collection cursor, dialogue task or outgoing receipt was changed.
