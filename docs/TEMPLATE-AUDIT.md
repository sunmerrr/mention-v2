# Engineering Templates alignment — 2026-11-12

Reviewed the accessible live index and applicable governance, bootstrap, decision,
configuration, error-boundary, path-hardening, rate-limit and shutdown documents.
This is a scoped source audit, not certification of every template block.

## Preserved authorized decisions

React SSR, Radix, the existing Python/SQLite collector, the single Kakao owner,
local/public permissions and durable classification receipts remain authoritative.
The new-project NestJS/PostgreSQL/Valkey stack is not an implicit migration order.
No authentication rollout, new infrastructure or collection policy is introduced.

## Corrected in this pass

- Explicit server page allowlist: unknown pages, missing assets and scanner paths
  return HTTP 404 before SSR/data queries. The response does not reflect the URL.
  Known conversation routes still perform their normal record/access checks.
- Library-based root and route render boundaries. The root fallback depends on
  neither router nor theme; the route fallback retains navigation, hides exception
  messages and offers a distinct manual refresh action for stale chunks.
- Boot-time Zod validation of the web server's environment overrides. Invalid
  ports, write flags and legacy URLs fail before creating adapters; errors identify
  fields without logging supplied values. Deployment-file fallback is preserved.
- Aggregate `verify` / `verify:full` commands reuse the existing checks; full
  additionally runs the existing browser suite. They do not launch a collector.
- VS Code provides attach-to-process and browser debugging for the managed server.
- `.env.example` documents the web overrides without runtime values or secrets.

## Existing alignment observed

- React/TypeScript strict, lazy route imports and request-scoped SSR query state.
- TanStack Query and URL-owned filters; no automatic mutation retries.
- Shared API envelopes/validation and structured Fastify/Pino server logging.
- Domain/application/adapter boundaries and rebuildable public read projections.
- Managed PID-based local lifecycle; shared component/token design system.
- Process-only health handler does not read databases or Kakao.

## Alignment extension

The user requested completing the audit, stability, verification and release work,
while leaving rate limiting out of this pass. Current implementation adds:

- Bounded, idempotent web drain: stop requests and timers, finish accepted requests
  and tracked projection work, drain adapters, then close resources. Managed restart
  now waits for process termination rather than health disappearance.
- Uniform workspace failure envelopes and unknown-route responses; normalized
  client network/non-JSON failures. Remote peers and forwarded requests cannot
  upgrade to local-only classification capabilities by spoofing Origin.
- UTC/KST utilities using pinned dayjs; strict calendar-date validation and
  tests at Korean midnight, invalid dates and local-time conversion.
- Durable, metadata-only web5xx records, isolated from collector databases.
- Hermetic populated SSR/browser checks, CI definition, a production-dependency
  multi-stage image, environment-specific Compose and guarded image promotion/
  rollback tooling. See [RELEASE.md](RELEASE.md) for unexecuted runtime stages.

The full index disposition is in [TEMPLATE-MATRIX.md](TEMPLATE-MATRIX.md). An
existing-stack compatibility exception is not equivalent to implementing the
reference stack. Source-level checks are not proof of remote CI/container execution.

## Remaining operational boundaries

- Rate limiting is deliberately deferred by the user's current scope. No Valkey
  or proxy-trust change was introduced.
- Docker is unavailable locally; container build/Compose/termination remain
  unverified locally. CI is defined but not claimed executed before push.
- No registry/remote production host/notification account was created. Container
  source integration and production cutover are not deployed.
- The original collector's IDs, SQLite schemas and independent workers remain
  compatibility boundaries; this pass is not a server-stack migration.
- Existing separate Pokergosu work was preserved.

## Verification history

The initial pass passed75tests and local desktop/mobile checks. Updated verification
results are recorded after the combined verification command, not inferred from
those earlier counts. No live test mutation, send, login or collector replacement
is part of this work.

## Combined verification and live web rollout

`pnpm verify:full` passed: TypeScript, repository-wide Biome,85unit/contract tests
in30files, client/server production builds,3hermetic browser tests and release
static checks. A real-socket SIGTERM test found a lingering keep-alive response;
the shared drain hook now closes accepted response connections after completion,
and the process test passes without interrupting the save. Synthetic promotion
and failed-health rollback preserve private env values and immutable image identity.
The production dependency audit reported zero advisories.

Only the managed web was restarted under the classifier queue lock. Final web
PID29465 returned200for health, populated overview and operations. Collector state
remained monitoring. Connection owner14379, analytics63074and dialogue63112were
unchanged. No collection setting, send, login, source schema or operational record
was changed for validation. Docker/remote CI/container source integration remain
unexecuted, explicitly separate from successful local source verification.
