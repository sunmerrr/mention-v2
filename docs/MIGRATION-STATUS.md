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
