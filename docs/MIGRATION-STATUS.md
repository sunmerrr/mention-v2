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
