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
