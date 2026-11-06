# Decisions

Recorded 2026-11-06. This is an existing-service replacement, not authorization to
rebuild all infrastructure or replace a running Kakao session.

| Decision         | Status / rationale                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace        | User-approved: `/Users/we/mention`; legacy project preserved.                                                                                                                                      |
| Rendering        | User-required SSR. The guide's React/Vite CSR default is an explicit exception here; React SSR does not require Next.js.                                                                           |
| Frontend         | Implemented: React 18.3.1, TypeScript 5.9.3, Vite 8.3.6 and TanStack Query 5.106.1; exact versions locked after dependency checks.                                                                 |
| SSR integration  | Implemented and verified: renderToPipeableStream, StaticRouter and hydrateRoot on the same React tree. No Next.js or DOM snapshot/replay renderer.                                                 |
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

Four new route views run locally in production-build preview, read-only by default.
Full legacy parity and production cutover are not complete. Source API costs on
cold reads remain visible in docs/VERIFICATION.md.
