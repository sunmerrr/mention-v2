# Server consolidation update — 2026-11-13

## Latest populated checkpoints

- Authoritative PostgreSQL conversation detail/classifications/guarded corrections
  and receipts are implemented. The frozen source reference contains741 public
  conversations,14220 context-message memberships and953 classifications; full
  detail/options comparisons remain identical after the migrations below.
- Native provenance now retains those741 public groups, their exact room IDs and
  all1661 episode-to-conversation aliases. Import validates complete active
  membership, room consistency and alias ownership atomically. It refuses silent
  retargeting. Old episode IDs resolve through detail/options/correction without
  changing human reviews or request-payload hashes. Full native-body/alias
  comparison found zero differences, alongside unchanged detail/classification
  parity. This is a source snapshot, not a running native collector or live
  history expansion implementation.
- Forum Node raw processing, resumed keyword reindex, finished read models and
  full historical archive have populated verification. See FORUM-MIGRATION.md.
- Latest native-reference `verify:full`:39 unit and44 integration tests, common
  Docker image and Compose checks. Live owner authentication, Chrome profile,
  native intake cursor, personal assistant and outgoing work remain unchanged.

Native raw-to-context/guide processing, quota-backed expansion, remaining
workspace functions and dialogue/schedule ownership still require implementation
and cutover verification. AWS SSH destination has not been supplied; there is no
real remote tunnel or public routing cutover. Prepared code and passing staging
checks are not reported as operational migration completion.

## Native episode identity and bookmarks

The active source snapshot's1661 original episodes now retain their own native
metadata alongside the741 grouped references. The optional episode import requires
complete alias membership and matching room identity; services and anchor times
are validated. This lets episode bookmarks use their actual title/time rather than
borrowing the parent conversation's anchor.

Bookmark listing, save, archive and restore now use PostgreSQL, with append-only
history, exact source identity and per-source write serialization. Original source
inspection in this pass found zero bookmarks and zero bookmark-history rows; a
final source delta check is still required before operational cutover. No existing
bookmark history is claimed imported merely from an empty snapshot.

The conversation-detail SSR bookmark prefetch no longer requires the legacy API.
With that API deliberately unreachable and writes disabled, canonical detail,
historical-alias detail and bookmarks passed desktop/mobile browser inspection
(six checks, no JavaScript failures or overflow). Inspection found an empty mobile
navigation label on hidden routes; the existing design-system Select now displays
the current route label while those menu entries remain hidden.

Backend/schema `verify:full` passed39 unit and45 integration tests plus Docker and
Compose checks. The final label correction also passed the complete normal verify
and repeat browser checks. Preview processes were stopped after QA; production
web, owner authentication, dialogue, schedules and send receipts were untouched.

## Native intake evidence format2

The owner cache contains recent logs followed by event wire snapshots. Choosing
the first matching native ID could bind a later cached revision to an earlier
event. Node intake now preserves all distinct related wire candidates in a
deduplicated PostgreSQL table, atomically with the event and owner cursor. Event
rows contain hashes rather than duplicating large attachments. Unknown or
ambiguous wire attribution is explicit; no candidate is silently selected.

Raw event identity depends on the native event, not mutable cache enrichment.
Changing wire cache data alone therefore does not create another received message.
Only event-related room/log evidence is retained; global room/name/private caches
are excluded. Own-message status uses verified account/author identity or a native
sent-log match; missing identity remains null rather than becoming false.

Synthetic PostgreSQL checks cover unchanged event replay plus new wire evidence,
atomic cursor advancement and preserved consumer fencing. A100-event regression
keeps a large repeated attachment in one wire row. Current `verify:full` passed
44 unit and46 integration tests plus the common image and Compose checks. Live
Kakao intake remains disabled pending the coordinated operational handoff.

## PostgreSQL native normalization worker

The common worker role now consumes durable native events without any owner RPC,
authentication or send dependency. Native room/message IDs remain exact decimal
strings, normalized messages use indexed native ordering, and the normalization
checkpoint commits with message changes and room revision markers. A new worker
resumes that checkpoint; identity inconsistency rolls back the entire batch while
the original raw records remain available.

Native send time and server observation time are separate fields. Missing or
ambiguous wire evidence leaves native send time unknown; presentation fallback is
explicitly tagged as observed time. Wire identity/type/author mismatch cannot
supply verified metadata. Native reply attachments use lossless JSON parsing;
history-end zero and19-digit reply IDs survive conversion. Own status remains
nullable when identity cannot be verified. Photo captions are retained as text.

This is the raw-to-message stage, not completed context/guide/dialogue migration.
Existing canonical public detail remains unchanged. Latest `verify:full` passed
48 unit and48 integration tests, Docker image and Compose checks, including a
mid-batch identity failure that preserves both raw input and the prior checkpoint.

## Populated native-message baseline

Native reference import now also builds the PostgreSQL message baseline. The
14220 saved conversation memberships contain13281 distinct room/message IDs.
Repeated memberships must agree on author, text, type, own flag, native timestamp
and reply identity; conflicting source content stops import before any message
write. Reference rows cannot replace intake-owned live messages and do not create
live events, room work or answering tasks.

Current and previous native group/episode reference bodies are retained in the
append-only migration archive before materialized references are replaced.
The original Python timeline rule provided an independent populated comparison:
all13281 normalized messages matched, including timestamps and exact IDs. The741
canonical public details and953 classifications also remained identical. Real
live intake count remained zero. Latest `verify:full` passed50 unit and49
integration tests plus the common image/Compose checks.

## Open-room intake boundary

Public intake additionally checks the owner's native room-kind cache using the
same OD/OM/OPEN kinds as the existing SDK. Verified private/service-room content
is excluded from both event and wire storage. Missing or conflicting room
classification retains the previous cursor and waits for verified metadata;
it does not authorize login, reconnect or a private-history probe.

Diagnostics distinguish checkpoint reads, owner reads and PostgreSQL commits.
They retain the error category and unverified room ID without logging chat bodies
or database query parameters. Synthetic PostgreSQL checks verify that private
event/wire contents never enter raw tables and unknown classification never
advances the cursor. Latest normal verify passed51 unit and50 integration tests.

The new preparation and remaining gates are documented in SERVER-CONSOLIDATION.md
and USEFUL-CONTEXT.md. Node owner intake, durable PostgreSQL raw inbox/cursors,
independent Node forum intake and a common role image have been implemented for
synthetic validation. Native collection remains disabled in this workspace.
Only item8-1 is deferred; item7 is now part of the migration. No production
routing, owner login, collection cursor or Chrome profile changed. The earlier
checkpoint below describes the existing transitional projection and still applies
until the remaining native behavior and write contracts are ported.

# Migration checkpoint — 2026-11-12

## Verified local implementation

The company NestJS/Fastify core now serves the preserved React UI and SSR.
PostgreSQL16/Drizzle stores a rebuildable public conversation/list/overview read
projection. Complete stable snapshots publish atomically; native IDs and evidence
are preserved. A separate company worker role synchronizes the projection, with a
PostgreSQL producer lease and notifications. It owns no Kakao connection.

Actual `pnpm verify:full` passed: lint, builds, unit tests, 15 API integration
tests including real PostgreSQL testcontainers, all three Docker targets, Compose
configuration and runtime placeholders. Production dependency audit: zero
advisories. One previously documented low development-tool advisory remains.
Full logs and browser QA artifacts stay ignored under `.dev/tmp/`.

The isolated Lima runtime has no host directory mounts or global Docker context.
Local API4200, preview5173 and projection worker4201 use `scripts/dev.sh`.
Browser QA covers all 17 available routes at desktop and mobile sizes, plus
intercepted write interactions. No browser test sends messages or changes native
settings/classifications. Mobile table clipping found during QA was corrected
using a shared ResponsiveTable design-system component.

## Explicit transition boundaries

Several detail/management reads and all authoritative native writes still use the
existing loopback Mention source on8790. The guarded mutation adapter preserves
request IDs, expected evidence and durable unknown states, and never retries
writes automatically. Preview writes default OFF. PostgreSQL is a public read
projection, not a migrated native history/receipt/settings database.

No public tunnel or production database cutover has occurred. The original web
remains live. Its pure date-conversion cache was optimized and that web process
alone restarted; Kakao owner, analytics and dialogue processes were preserved.
No login, reconnect, test send, source recovery or pending replay was performed.

## Remaining before independent company deployment

- Remove or formally deploy the loopback source dependency; verify populated
  container access without exposing native/private services.
- Complete authoritative writer/history ownership migration and parity checks.
- Select internal authentication, deployment destination and rollback routing.
- Define changed-generation retention and production rate-limit policy.
- Perform populated staging verification before public routing changes.

Docker images build, but local Compose is not a claim of a populated independent
production installation: host-loopback source/database settings need an explicit
container deployment configuration. Global refresh invalidates browser queries;
projection catch-up remains periodic or mutation-notified.

## Excluded-promotion reaction continuity

The preserved UI contract now carries optional promotionReference metadata and
identifies direct replies versus topic candidates without fabricating literal
keyword occurrences. Company API envelope tests preserve that nested provenance.
The native analytics source owns metadata-only ad watches and actual reaction
capture; this remains an explicit source dependency, not a claim that the Nest
worker owns Kakao. Desktop/mobile synthetic browser checks and native boundary
regressions passed; first natural-event verification is reported independently.

## Forum and source-policy checkpoint — 2026-11-13

See FORUM-MIGRATION.md for completed Node/PostgreSQL forum reads/reviews,
source-policy storage, preserved latest UI, populated source-reference comparisons
and fourteen desktop/mobile page checks. Native collection/dialogue and remaining
workspace parity are still pending; no public routing cutover has occurred.

## Complete native operating-state archive

An isolated read-only SQLite backup captured all41 existing monitor tables,
including excluded/hidden messages, guide state, entrances, followups, schedules,
uncertain send receipts and historical reviews. The new import-native-state role
stores this as immutable PostgreSQL migration evidence, not executable jobs.
Only complete manifests publish; interrupted imports resume with exact hashes,
changed records and unknown settings keys are rejected. Unsafe numeric native
identifiers are represented losslessly as decimal strings. Binary SQLite values
use an explicit base64 wrapper in the private export.

The populated snapshot contained83394 rows (28.7MB); full row/body/hash comparison
found zero differences after import. The live intake table remained empty. This
archive does not claim those records have all been converted to active Node
features. Per-feature materialization and preserved delivery ownership remain
migration gates. Snapshot files are private, ignored and mode0600; the original
DB and all running production processes were untouched.

Actual verify:full passed51 unit and54 integration tests, common image, reverse
SSH and Compose checks. No AWS destination, remote tunnel, public routing change,
owner restart, authentication action, live send or historical replay occurred.

## Collection-target PostgreSQL slice

The import-native-rooms role materializes a complete archived source snapshot
into room policy and precomputed per-day message metrics. It retains native room
IDs, names, joined/excluded state, verified-title metadata and source gaps. Message
metrics use the existing include/exclude matching rules, including numeric
exclusion patterns; web reads do not scan message evidence. Import replay is
idempotent and a different source snapshot cannot silently overwrite edited
policy: it requires a separate reviewed handoff.

In PostgreSQL mode the preserved workspace rooms read and room-settings mutation
now use these tables. Bulk selection validates all room IDs before any change,
deduplicates selection, writes policy history and creates a gap on exclusion
removal. Repeated inclusion creates no duplicate gap. No guide/respond/schedule
state, host-owner configuration or original records are changed by this operation.

Populated comparison used the original Python room-page/overview rules on the
same isolated snapshot:22 included,1 excluded,1 inactive room, and all returned
fields/counts matched. Desktop/mobile default and searched pages passed four real
Chrome checks with the legacy API unreachable, no hydration/JavaScript failures
or overflow. Screenshots were visually inspected. Preview was stopped afterward.
Actual verify:full passed51 unit and55 integration tests plus image/Compose.

This is a migrated configuration screen and preserved baseline, not a claim that
new inventory/live keyword-count refresh or analytics/guide worker cutover has
finished. Those workers must consume the same PostgreSQL policy before routing
production to the replacement. Existing production policy remains authoritative
until the coordinated handoff.

## Guide configuration and saved-message slice

PostgreSQL guide rooms, saved messages and append-only setting history are now
implemented. The explicit import-native-guide role materializes the complete
archived guide baseline;408 message bodies, original configuration, reply metadata
and followup context matched the frozen source without differences. Reimport is
idempotent, and a different snapshot cannot silently replace edited configuration.
Historical records are stored only: no answering task, entrance event, outbox
attempt or past-message replay is generated by import.

Guide settings validate existing joined room identity, independent enabled/respond
switches, bounded distinct words and the original reference URL/document rules.
Omitted references retain the previous configuration. Analysis exclusion does not
block guide capture; respond=false does not disable capture. Settings never expand
send allowlists or change host-owner/assistant configuration.

The preserved guide workspace and settings actions use PostgreSQL in staging.
Responder ownership is explicitly reported as not transferred. Outbox file states,
current health, live capture/entrance/followup logic and scheduled answering are
not claimed migrated by this slice; reply delivery status is not yet available
from this read model. They remain required before production cutover.

Actual verify:full passed51 unit and56 integration tests plus Docker/Compose.
Four real Chrome desktop/mobile list/settings checks passed with the legacy API
unreachable; mobile settings were visually inspected. The preview was stopped.
Production owner, responder, worker schedules, tokens and send receipts were
untouched. AWS SSH target remains unavailable and no operational cutover occurred.
