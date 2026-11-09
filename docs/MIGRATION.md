# Legacy feature inventory and migration plan

Legacy source: `/Users/we/Desktop/kakao-0.4.0-analysis-20261102`.
Primary service documentation: `monitor/README.md`; current routes: `monitor/app.py`.
Treat old README sections as chronology, not a single current deployment manifest.

| Existing route  | Required behavior to preserve                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`             | Period/target filters; trends and sentiment; target/alias grouping; linked conversations; coverage cautions. |
| `/trends`       | Date and target comparison, daily metrics and source evidence.                                               |
| `/reviews`      | Confirmed AI/human classifications; edit labels/notes; evidence/conflict guards and history.                 |
| `/conversation` | Grouped context, keyword highlighting, context expansion, relevance, target-specific evaluations.            |
| `/episode`      | Source episode, context/relevance/quality and campaign detail.                                               |
| `/messages`     | Keyword-matched records, photos when retained, search, dates and downloads.                                  |
| `/keywords`     | Include/exclude patterns, manual target/alias grouping and validation.                                       |
| `/rooms`        | Joined rooms included by default, exclusion management, existing records retained.                           |
| `/campaigns`    | Reaction observations and authorized local-only send behavior.                                               |
| `/responses`    | Comparable observations with confirmed relevance and source evidence.                                        |
| `/briefing`     | Date reports, image exports, revision/staleness and authorized local-only delivery.                          |
| `/bookmarks`    | Important conversations, categories, notes and workflow state.                                               |
| `/aliases`      | Candidate aliases, apply/dismiss/reconsider.                                                                 |
| `/operations`   | Collection gaps, recovery certainty, backups and local verification.                                         |
| `/guide`        | Existing room guide settings and history, separated from private assistant state.                            |

## Facts and limits

AI classifications were explicitly changed to immediate confirmed publication.
The earlier ai_reviews preview and its proposal queue are historical prototypes.
Twelve pilot decisions were published, including four user-reviewed decisions;
this is not a claim that every retained conversation has already been classified.
Existing human corrections and original monitoring records must survive migration.

A requested context policy of at least fifteen useful messages on each side must
be verified against code and real saved context; do not label it implemented just
because it was discussed. Ignore greetings/noise as conversational evidence and
keep promotional/media background inspectable without pretending it was read.

## Stages

1. Foundation: decisions, source inventory and UI reuse baseline (this setup).
2. One SSR vertical slice with synthetic fixtures; verify hydration/routing.
3. Lightweight summary/list/detail query contracts and measured query/payload costs.
4. Read-only integration with the current service; verify filtered classifications.
5. Confirmed-classification edits with parity tests and durable receipts.
6. Remaining screens, exports, permissions and operational continuity checks.
7. Explicit production cutover with a reversible plan; no collector/session reset.

Do not begin by copying SQLite files or adding a second collector. Do not mark a
stage complete without the associated code and verification evidence.

## Initial slice status: 2026-11-06 (superseded by restoration below)

- Stage 1 complete: charter, decisions and boundaries recorded.
- Stage 2 complete for the first slice: React SSR, hydration, lazy routes and real
  Radix UI, with unit/contract tests and browser checks.
- Stage 3 partial: bounded browser DTOs and cursor API are implemented. The
  legacy compatibility adapter still reads the full upstream dataset on cold
  refresh; source-query optimization is not complete.
- Stage 4 complete for the first slice: read-only overview, conversation list,
  detail and classification review use current public monitoring data.
- Stage 5 prepared: edit dialog, validation/conflict forwarding and mutation
  invalidation are implemented; synthetic writes are tested. Live write access
  remains off in the preview and no real classification was edited in tests.
- Stages 6 and 7 not complete. Management, exports, campaign/briefing features,
  true source pagination, and a production cutover remain with the legacy app.

## Feature parity restoration: 2026-11-06

The user rejected replacing the operational UI with an incomplete preview. All
listed monitoring screens and existing mutations/exports are now connected in
React routes, with SSR/hydration and the same collector/state boundary. Monitoring
writes are enabled in the active deployment. Local delivery/backup restrictions,
request identifiers, receipts and evidence guards remain in force. No collector
restart, private-worker change or live test send was used for this restoration.

Stage 5 is enabled and synthetic-contract tested; no real user classification was
changed merely for testing. Stage 6 UI/integration parity is implemented and
deployed, with read/download smoke tests and intercepted browser mutation tests.
Source-query pagination and cold-query optimization in stage 3 remain incomplete;
UI parity does not imply that work has been completed. Public hosting remains the
existing temporary tunnel. See FEATURE-PARITY.md for exact verification limits.

## Public read path improvement: 2026-11-09

Stage 3 now includes a durable overview read model and real indexed SQL keyset
pagination over conversation previews in the new web runtime. Reopening the web
process uses the retained generation immediately. Full source insights grouping
moves to a coalesced background rebuild; it has not become incremental. Cold
briefing/trend/classification-history reads still follow their existing adapters.
See VERIFICATION.md for process-restart measurements and source-rebuild limits.

## Shared aggregation producer: 2026-11-09

The next stage replaces whole insights socket recomputation for public read views
with a read-only allowlisted source snapshot and shared aggregation worker. Trends,
briefing and classification history now reuse the grouped dataset. Unchanged room
calculations and unchanged result generations are retained. Source writes/deliveries
still use the collector; no source schema/index migration or collector restart was
performed. Public table scanning and changed-room history rebuild remain limitations.
