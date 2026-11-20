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

Live intake now adds open rooms observed in validated owner event batches and
refreshes verified titles in the cursor transaction. Existing inclusion,
exclusion, membership and metrics survive title updates. Owner cache absence
does not identify a departure, and rooms that have not yet produced events
continue to use the archived inventory. Live metrics and operational worker
handoff still require verification. Existing production policy remains
authoritative until the coordinated handoff.

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

## 2026-11-18 Kakao analysis migration rehearsal

- The NestJS worker now turns normalized Kakao messages into canonical evidence
  when explicitly enabled with `KAKAO_CONTEXT_ENABLED=1` and
  `MONITORING_EVIDENCE_BACKEND=postgres`. It uses the PostgreSQL room and keyword
  policy, waits for a bounded follow-up window, and commits the evidence and
  checkpoint together. Imported anchors and existing reviews survive replays.
- New native evidence has up to 30 useful messages per side. Detail initially
  returns at most 15 per side. Expansion reads the already saved evidence and
  never requests native history. Legacy records still use existing behavior.
- A read-only copy of the active SQLite database was imported into isolated
  PostgreSQL 16. The rehearsal verified 107,769 records across 41 archived
  tables, 28 room policies, 2,569 legacy episode links, 20,148 retained native
  messages, and a completed projection of all 1,255 conversations. All 1,607
  imported classifications matched the export by ID, label, note and origin.
- The live worker remains on Python/SQLite. Live room inventory and Kakao
  image handling, final delta and cursor reconciliation, AWS reverse SSH
  verification and public routing are pending.

### Retained photo archive and initial cursor verification

The photo exporter reads a SQLite snapshot and copies referenced originals and
thumbnails into a private bundle keyed by SHA-256. The Node `import-native-photos`
role reads `NATIVE_PHOTO_IMPORT_DIRECTORY`. PostgreSQL stores one byte payload per
digest and preserves the existing photo URLs, download names and current keyword
visibility filtering. This covers retained images. The live collection and
image retention handoff must be verified before retiring the legacy collector.
The November 20 rehearsal verified all 43,038 photo and thumbnail routes and
6,689 unique byte payloads in PostgreSQL, with zero missing files, checksum
mismatches or unmatched routes in that snapshot.

For first attachment, set `NATIVE_STATE_SNAPSHOT_ID` to the complete final archive
and `KAKAO_START_CURSOR` to its committed analysis cursor. Before committing a
PostgreSQL intake offset, the worker compares the cursor to that archive and
probes the same live owner for an explicit gap-free response. It does not advance
the cursor through that probe. Use the final cutover snapshot, not a rehearsal.

### Grouping and promotion attribution

- The publisher uses the legacy same-room overlap and participant thresholds
  within the Korean day. It commits each group with aliases for its individual
  anchors. A group becomes eligible to publish after the 30-minute grouping
  window and the additional 15-minute follow-up window. Published groups keep
  their evidence and decisions if messages arrive after publication.
- Excluded promotions can contribute only a metadata reference to published
  evidence. Native replies and inferred topic candidates are distinguished,
  including target ambiguity. Repeated copies of the same ad do not create new
  subjects for inference.
- Given the same already-selected messages, the Node grouping rule reproduced
  all 1,258 legacy groups for 2,572 episode entries across 182 samples from an
  operating snapshot. Promotion attribution matched the Python pipeline on
  all ten synthetic scenarios. These checks cover rules and do not constitute
  verification of a live cutover or exact parity of per-episode context selection.

### November 20 local migration rehearsal

The one-off exporter makes a read-only consistent SQLite copy and writes its
approved analysis tables to a private JSONL file. It includes the confirmed
observation bindings and current keyword policy. Use a new destination for each
export.

```sh
python3 scripts/export-native-state.py --database "$ANALYSIS_SQLITE" --output "$SNAPSHOT_FILE"
```

A populated PostgreSQL rehearsal imported 123,235 records across 42 tables,
28 rooms and 23,898 retained context messages. The published projection contained
1,484 conversations. All 1,863 imported classification records matched their
source IDs, labels, summaries, origins and evidence tokens. The forum workspace
import contained 613 posts and 59 classification request receipts. It also
archived 9,133 raw records, including 5,426 thread records. Workspace
imports publish the initial completed forum opinion model so the combined page
can read it immediately.

The Node photo worker queues selected context attachments, uses the existing
owner RPC for downloads, generates a preview and stores byte-identical output
once by SHA-256. The same-host staging path has to be visible at the same
absolute path to both processes. The production image does not enable live
media collection by default. Runtime processing errors include the full
available stack and cause chain in PostgreSQL and omit SQL values and
credentials.

A browser rehearsal with the source unreachable verified the PostgreSQL home,
combined, Pokergosu, conversations, review, keywords, rooms, guide and bookmark
pages. Messages, trends, reaction observation and comparison, briefing, aliases
and operations still delegate to the previous source. The confirmed observation
bindings are archived. The Node worker does not consume the live observation
broker yet. Retiring the legacy local service before these routes and the broker
are migrated would interrupt those functions. The last rehearsal was isolated.
The owner, legacy analytics and existing public route continued serving.

### PostgreSQL workspace implementation

The PostgreSQL API now owns the message record and its cursor pagination, JSON
and CSV exports, context CSV, trends, briefing revisions and PNG, alias
decisions, operations status, and reaction observation reads. The message
timeline is produced by the worker from an explicitly selected archive and
normalized native intake. A keyword policy change publishes a consistent
timeline while retaining stable message cursors. The web server uses completed
projections and stored context. The API does not ask the Kakao connection owner
for history.

Confirmed observation registration has a separate, optional private socket
client. The worker validates the established receipt, preserves a matching
archived observation ID, commits the anchor and retained evidence, then
acknowledges. Enable it only after the old analytics consumer releases the
handoff. Activity from excluded rooms stays outside shared reaction views.
PostgreSQL backup operations use the worker, a private volume, and a separate
temporary restore database.

The 12:33 KST export contains 123,689 records across 42 tables. Its PostgreSQL
rehearsal produced 1,495 conversations and matched 1,876 classification
records. The live owner's read-only cursor probe confirmed continuity from
that archive position. These results cover the rehearsal. The live dashboard
and analysis consumer still used the existing route when this was recorded.
The remaining operational gates are final media and cursor delta reconciliation,
unattended local process routing with rollback, and verification of the remaining
legacy mutation paths, including delivery actions and inherited review history.

The populated browser test runs with the legacy HTTP source unreachable. It
checks the message list, trends, briefing, operations, alias candidates,
reaction observations and comparisons. It also verifies the message CSV,
context CSV, JSON and briefing PNG routes. A separate Compose rehearsal
queued a backup through the API, used PostgreSQL 16 tools in the worker,
successfully restored the dump, and removed the temporary verification database.

The refreshed photo archive contains 43,195 routes and 6,703 unique objects.
It reused 6,689 byte-identical objects without creating another physical copy.
The 157 changed routes were imported into disposable PostgreSQL and matched
all 147 referenced objects. The image count excludes zero missing assets and
zero lost routes compared with the earlier archive.

The local reverse SSH rehearsal mounted the forwarded connection socket in an
isolated Docker container and completed a read-only owner status request.
Rootless identity mapping was verified for that mount. A second backup rehearsal
verified dump and restore with the actual guest's non-default user ID, after
initializing the dedicated private backup volume with matching permissions.
