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
it does not propagate settings to the host owner or Chrome. The actual reindex
consumer and complete Kakao raw-to-analysis pipeline are still pending. Do not
claim queued keyword saves are end-to-end complete before that consumer is wired.

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

Complete keyword-job consumption, raw forum intake processing, context quotas and
DB-only expansion, remaining workspace/exports/briefings, native dialogue/schedule
migration, preserved historical state/cursor delta and complete page/action QA.
The seven-page read-only check is not a claim that every original feature has
already moved. The production shared link still uses /Users/we/mention. The
existing Chrome receiver/profile and native Kakao connection remain unchanged.
