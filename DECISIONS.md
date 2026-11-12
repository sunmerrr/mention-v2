# Mention internal migration decisions

## Authorization and baseline

- User authorized company-template migration on2026-11-12, preserving the current
  service while the replacement is built and tested.
- Workspace: `/Users/we/mention-internal`; current production: `/Users/we/mention`.
- Source boilerplate: https://github.com/ohclub/project-template-boilerplate
- Exact baseline: `37f972c9091e4108e9279f3f5a5ca28e5a2d13d0` (main).
- Published v1 points to `492d6980e6a837a06e9c6a4d25335bbf8cb24893`;
  this workspace copied main, not the older tag. Upstream original is untouched.
- The current single Kakao connection, collection/dialogue workers, private
  assistant, durable receipts, settings and source records remain outside cutover.

## Blocks

| Block | Decision | Implementation status |
| --- | --- | --- |
| Core | ON | Copied company NestJS/Fastify, role/envelope/config/Pino/validation, React/Vite/Tailwind/Query foundation. |
| PostgreSQL / Drizzle | ON for target architecture | Pending reference implementation, schema mapping and disposable DB verification. No source migration run. |
| Valkey | Planned only where template blocks require it | No service created; rate-limit rollout remains deferred by the user's earlier scope. |
| Authentication | Not yet selected | Existing shared-link behavior remains; internal SSO/provider is not assumed. |
| Worker | Existing functions must be preserved | Ownership/design mapping before changing schedules or adding instances. |
| WebSocket | OFF | No new realtime transport requirement. |
| Upload / payments | OFF | No new product requirement. |
| Separate admin | OFF | Existing dashboard management must be preserved, not a new identity product. |

## Preserved product requirements

Every existing monitoring screen, operation, guarded edit and export must survive
migration. Preserve AI/human attribution, human priority, expected evidence tokens,
request IDs, durable unknown states, excluded-room/keyword policy and KST day
boundaries. Read-only equivalence precedes writes. A proxy to the old API is a
transition adapter, not proof of PostgreSQL migration.

The previous explicit SSR requirement remains until the user changes it. The
company boilerplate starts as CSR; its rendering decision must be reconciled
before frontend cutover. Do not silently discard SSR or hand-built design rules.
Existing UI/design-system migration requires parity and browser inspection.

## Actual blockers and human decisions

The supplied lockfile audit reports security advisories, including critical
advisories in transitive tool dependencies. No vulnerability is inferred to be
exploitable in production solely from audit severity. The guide's escalation rule
requires a human decision before selecting replacement versions. Requested:
security-patched compatible versions versus an updated company baseline.
User explicitly approved selecting security-fixed versions on2026-11-12.
Proceed with patched compatible dependencies; record necessary major-version
changes and regression verification rather than retaining vulnerable lock entries.

Docker is not installed on this Mac. Real PostgreSQL/Valkey/testcontainers and
`verify:full` cannot be claimed passed until a Docker-capable environment exists.
The user has no separate reference repository. Proceed from the supplied common
core and applicable guide blocks; no reference URL is a prerequisite.

## Migration gates

1. Approved baseline and security versions; reproduce core verify.
2. Read-only monitoring contract slice and fixture parity.
3. PostgreSQL schema/import plan; synthetic imports, counts and evidence signatures.
4. Preserved frontend screens and SSR decision, permission matrix and browser tests.
5. Guarded writes/receipts and isolated worker equivalence.
6. Immutable build, populated staging and reversible production cutover proposal.

No stage is complete merely because its directory exists. No production cutover,
login, reconnect, live test send or mass classification change is authorized by
creating this workspace.

## Security baseline verification

Security-fixed baseline now passes the actual `pnpm verify` command on Node24.14.0.
Production dependency audit reports zero advisories. One unpatched low-severity
transitive development-tool advisory remains documented in BOILERPLATE-BASELINE.md.
NestJS11 and React18 are retained. Router7/Vite8/Zod4/Vitest4 and supporting
plugins are authorized security compatibility updates. Shared source contracts
and tests will be migrated against those pinned dependency versions.

## First monitoring slice

Authorized migration starts with read-only Nest monitoring endpoints for overview,
conversation lists/detail and classifications. The transition repository performs
GET only against a credential-free loopback source, without forwarding local
privileges, cookies or request Origin. Shared Zod schemas bound filters and cursor
size. No compatibility proxy is claimed to be a completed database migration.
The source defaults to the current authorized Mention8790service and has a bounded
timeout. Tests must use a disposable synthetic source and reject redirects/errors.

## Read slice verification

Actual verify passed after adding the first read slice:6unit and8API integration
tests. Six actual read-only source comparisons returned identical data. New API
was stopped after validation; existing Kakao owner/processes and the running web
were unchanged. See docs/MIGRATION-STATUS.md for remaining migration gates.
