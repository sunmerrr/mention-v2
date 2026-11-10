# Architecture boundaries

Proposed layout, to be filled by verified vertical slices:

```
apps/web/src/                 React routes, components and SSR/client entries
apps/read-api/src/            Lightweight web-facing query endpoints, if needed
packages/domain/src/          Pure product types and rules
packages/application/src/     Use cases and narrow read/write ports
packages/contracts/src/       Versioned transport DTOs and validation schemas
packages/ui/src/              Selected component-system integration and tokens
docs/                        Decisions, migration and verification evidence
```

Domain and application code must not import React, HTTP clients, SQLite or Kakao
SDKs. Avoid introducing a separate service merely because the folder exists.
The existing collector stays the only owner of the Kakao connection and monitoring
DB writes. Its integration adapter preserves public/local request scope.

## Read contracts

- Overview: selected-period aggregates, target counts, classification coverage,
  comparison period and collection coverage; no transcript arrays.
- Conversations: cursor + capped limit + filters; concise previews, stable IDs,
  next cursor; no full context for every row.
- Conversation detail: only the chosen conversation's context, attribution,
  available range and evidence version.
- Classifications: cursor-paged confirmed labels with origin, revision and notes.
- Classification edit: expected evidence/revision and stable request ID, returning
  the saved revision; preserve previous values, reject conflicts, do not auto-retry
  uncertain writes under a new identifier.

A facade that fetches the legacy ~945 KB response and slices it is only a temporary
compatibility adapter. It is not the completion of backend pagination or latency
work. Prefer precomputed/query-efficient read models inside an explicitly designed
boundary, without adding an uncoordinated production SQLite writer.

## Existing monitoring capability adapter

`WorkspaceQueries` depends on `WorkspacePort` and a finite read/action catalog. The
Fastify boundary enforces writes/origin/local capability checks. CollectorTransport
and collector_bridge.py validate allowed paths, carry explicit public/local scope,
and preserve binary bytes and upstream error statuses. Existing collector
validators remain authoritative for these compatibility commands. No arbitrary
URL proxy, private assistant endpoint or collector lifecycle operation is exposed.
SSR preloads only the active route, plus briefing delivery or source bookmark
metadata actually rendered by that route. Request scope includes local capability
and is hydrated unchanged. Monitoring data edits invalidate derived read caches;
a committed write is never reported failed merely because a later refresh failed.

## Durable public monitoring projection — 2026-11-09

`MonitoringProjection` is an application port, implemented by `MonitoringReadModel`
using Node's built-in SQLite in a separate ignored runtime file. The collector
operational DB is never opened. Its existing public socket endpoint remains the
only input, and legacy detail/writes remain authoritative.

A background producer normalizes the public dataset, partitions days once,
materializes day/target counts and highlights, and replaces summary/conversation/
label tables in one transaction. Reads see a complete old or new generation;
failed transactions roll back. Indexed day/time/ID and target/label tables provide
SQL filtering and keyset paging with a limit+1 lookahead. Summary reads never load
all conversation previews. Cursor scope validation and Korean calendar boundaries
match the domain fallback. A single generation contains only public data and is
safe to share between public/local readers; local capabilities are never stored.

Startup can immediately serve a persisted generation while refreshing. A clean
installation waits for initialization instead of serving false empty totals.
Rebuild failures preserve generation timestamps. Explicit/post-write refresh waits
past an older in-flight rebuild before requesting a new source generation. Normal
background ticks coalesce. The producer still rebuilds from the full upstream
insights endpoint, and the separate classification-history/trend/briefing adapters
are not optimized by this change.

Page-level form actions use native external form association in a sticky heading,
rendered in SSR as well as hydration. Keyword, selected-room guide, briefing
schedule and episode assessment forms keep their own validation and save state.
Repeated record editors remain scoped to their individual item; send/create/test
commands do not turn into page save actions.

## Shared read-only aggregation producer (supersedes the socket-only producer)

`AnalyticsTransport` intercepts only insights, trends, briefing and classification
GET reads. All writes and other capabilities delegate to CollectorTransport with
the original local/public flag. The web owns one serialized Python child over
stdin/stdout, coalesces identical concurrent reads, restarts only that read child
after its failure, and closes it with the web process. It has no network listener,
Kakao client, authentication action, schedule or outbound messaging function.

The producer takes a consistent SQLite read-only snapshot of explicitly allowed
analytics tables and three keyword-related settings. It never copies the source
DB to disk, reads private tables/settings, calls operational constructors or runs
migrations. Source locks are released before building temporary indexes or doing
CPU work. The memory DB is query-only after population. Missing schemas/locked
sources fail the read; the durable overview projection retains its prior generation.

Full public-input hashes invalidate result caches. Per-room hashes include message,
episode, link, correction, evaluation, review history, room name, photo and gap
inputs plus global keyword configuration. Cross-room grouping was already forbidden
by the original algorithm, so unchanged-room details/groups can be retained while
preserving stable ordering at tied anchors. Read-only trend and briefing consumers
reuse grouped conversations; they do not mutate that cache. Korean calendar dates
and classification-audit file versions are part of result keys. Briefing image
availability is checked separately on cache hits. Cache limits bound retained
result/detail/room/full-group generations. No source transcript is persisted by
this producer. Condensed previews remain in the existing ignored public read model.

Remaining cost: scanning/fingerprinting all public rows, memory snapshot creation,
and rebuilding a changed room's historical candidates. This is room-incremental
computation, not a source change stream or per-row incremental SQL aggregation.
The collector's existing save/send/render commands retain their own calculation
cost and authoritative validation/receipts.

Unchanged-file fast reads additionally require matching DB/WAL/journal file identity,
size and nanosecond mtime/ctime. A source version is retained only when unchanged
across the consistent read, and never while a rollback journal exists. A changed
file falls back to a public-content fingerprint, so unrelated private writes do
not cause conversation recomputation. Audit/date/query/image dependencies remain
separate. Matching concurrent public reads coalesce without combining local-only
or mutation requests.

## Alias suggestion evidence and precomputation

The read worker also produces alias suggestions. A separate alias evidence policy
removes promotion/link announcements before re-running the existing candidate
algorithm. Repeated templates normalize URLs and digits for promotion triage;
long schedule/link advertisements are excluded conservatively while actual
questions/opinions remain eligible. This only affects suggestion evidence, not
message retention, keyword membership, sentiment data or previous decisions.

The displayed candidates are intersected with the collector's original candidate
set because that live collector still authoritatively validates alias additions.
Filtering must not produce an Add action that bypasses its eligibility/audit rules.
This can withhold newly surfaced candidates outside the collector's original cap;
no live collector code is hot-loaded or restarted to change that boundary.

Default 14-day suggestions are generated at startup and every minute, persisted
atomically under ignored runtime/alias-suggestions.json (0600), and served in pages
of 12. Successful decisions update the visible cache only after upstream success
and schedule a fresh generation past any older in-flight read. A failed regeneration
retains the prior successful generation and its timestamp. Other requested day
ranges still use the filtered read worker on demand. Source decisions remain the
only durable audit; cached display confirmation does not write another audit.

UI headings identify the proposed target. Unresolved and mere cooccurrence entries
are folded separately; missing targets never default to the first select option.
Adding requires an explicit target. Evidence starts folded, the select label is
SSR-visible, and processed decisions also display their target. Active alias pages
refresh from the precomputed result once a minute, paused while editing forms.

Alias suggestions additionally run the exact collector keyword matcher on the
candidate token itself, using the snapshot's current configured keywords. A token
already recognized by that matcher adds no collection coverage and is withheld
from suggestions regardless of its discovery method. This handles Korean suffixes,
attached phrases, digits and Unicode/case variants without implementing a separate
stemmer or changing collection rules. Unrecognized spellings remain reviewable.
The persisted alias snapshot policy is version 2; older generations are rebuilt.

## Conversation collections and navigation origin

The overview materializes separate latest/positive/negative collections, capped at
four conversations each. Latest sorts by the last connected stored utterance,
retains per-target valid opinion summaries and explicitly marks missing summaries.
Reaction collections require the exact confirmed stance, a current evidence state,
a nonempty summary and at least three retained messages. Mixed/uncertain/unreviewed
labels never become positive or negative by word matching. One conversation can
have different target-specific stances; target and AI/human attribution are retained.
This UI reuses existing context assessments; it does not generate new summaries for
unclassified history or claim that every conversation has been analyzed.

The read worker exports at most three actual text excerpts (180 characters each),
with native IDs, speaker, timestamp, owner marker and truncation flag. Selection is
near a meaningful anchor/keyword-bearing message; no arbitrary first messages are
substituted if that anchor is absent. Latest omits explicit empty excerpts. Context
relationships remain inspectable rather than being presented as proven semantic
connections. No full per-conversation source request is added to overview loading.
The durable overview projection version is 2, forcing an older read model rebuild.

Related context/review/source links carry an allowlisted nav origin in the URL.
Sidebar/mobile selection uses that origin for drill-down pages; direct sidebar
navigation clears it and chooses the new menu. URL-based state survives reload and
back/forward without SSR hydration disagreement. Date/target API scopes do not
include this presentation-only parameter. No collector lifecycle changes are made.

First human classifications are handled by the web bridge extension `classification_initial.py`, without changing/restarting the collector. It first delegates existing corrections to the legacy audited writer; only NO_CONFIRMED_LABEL permits the initial path. The initial path rechecks the exact evidence/evaluation token, appends saving/saved/unknown records to the existing audit, verifies the resulting label/signature, and preserves replay/uncertain semantics under the existing process file lock. Conversation-scoped options include unclassified targets with null origin; public pending analyses do not become human decisions until explicit selection.

Conversation list evaluations carry the exact source correction token computed before presentation enrichment. Indexed review_state separates unclassified/recheck/classified, with pending as their union; cursor scope includes state. The list reuses ClassificationControl with no per-row detail reads. Read-model generation 4 migrates its own labels table only. Reaction comparison options are scoped by explicit campaign request provenance: mention_v2_ for newly created dashboard observations, known scheduled_/welcome_/news_ for external automation, and otherwise legacy/unknown. No title or room-name inference establishes dashboard origin. No comparison is chosen implicitly, and selected IDs must belong to the source scope. Existing pending delivery IDs are preserved.

Judgment exclusion is a dashboard-owned decision overlay, persisted in private runtime/judgment-decisions.db with revision tokens, per-target serialized writes, durable request reservations and append-only audit events. It does not send unsupported verdicts to the collector, stop capture or delete messages. Exclusions are outside opinion and pending denominators; excluded targets can be explicitly restored via the existing audited source writer. An ambiguous restoration remains unknown and is never automatically replayed. Historical conversation IDs are retained; newly regrouped IDs are not silently given an old exclusion.

Public analytics snapshots discard rows belonging to currently analysis-excluded rooms in their disposable in-memory copy, while retaining room configuration and operational gap status. This closes a legacy path where confirmed campaign anchors were materialized into public message/mention tables despite room exclusion. Collector storage, private guide capture and receipts are not deleted or modified by this scope enforcement. Current excluded-room history is not part of live public trend/list/overview analysis.
