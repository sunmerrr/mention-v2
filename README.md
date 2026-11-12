# Mention

React SSR replacement for the Kakao open-chat sentiment and trend dashboard.
Workspace: `/Users/we/mention`. Legacy service remains separate and unchanged.

## Restored monitoring workspace

The existing monitoring features now run in the replacement React SSR application:

- Sentiment overview, meaningful reaction examples, dated trends and evidence.
- Cursor-paged conversations, keyword highlights, photos, context expansion,
  relevance review/undo and source episode/campaign evaluation.
- Confirmed-classification editing with evidence/conflict checks and audit history.
- Include/exclude keywords, manual target/alias groups and automatic suggestions.
- Room exclusions, compact guide management and per-room rules/references.
- Searchable message/photo records, date-specific message/context CSV and JSON.
- Reaction observation/feedback comparison, daily brief versions and image exports.
- Bookmarks/owners/workflow, alias candidate decisions and reconsideration.
- Collection-gap/recovery evidence and existing backup/restore verification actions.
- Local-only campaign delivery, briefing recipients/schedules/delivery and backups
  retain the existing collector restrictions and durable receipts.

Local UI: **http://127.0.0.1:8790/**. The existing user-authorized Cloudflare tunnel
serves this same application; `runtime/deployment.json` records its public origin.
The deployed instance now has monitoring writes enabled, as requested for feature
parity. Default code configuration remains read-only; `MENTION_ENABLE_WRITES`
overrides the local deployment setting. Chat sends and backup actions remain local.
This does not enable a private assistant, change workers, log in or reconnect Kakao.
See [feature parity and verification](docs/FEATURE-PARITY.md).

## Run

Use Node 24.14+ (verified locally on 26.13.0) and pnpm 9.15.9. Exact dependencies
are pinned in package.json and pnpm-lock.yaml.

```sh
npx --yes pnpm@9.15.9 install --frozen-lockfile
./scripts/dev.sh start                  # development, one managed web process
./scripts/dev.sh stop
npx --yes pnpm@9.15.9 build
MENTION_PRODUCTION=1 ./scripts/dev.sh start
./scripts/dev.sh status
```

The lifecycle script starts only this new web process. It never launches or
restarts the legacy collector. It records the web PID and private logs in ignored
`runtime/`. Set `MENTION_LEGACY_URL` to the existing loopback dashboard (default
`http://127.0.0.1:8766`). The deployed instance uses the collector Unix socket via
its configured legacyRoot, not that retired TCP port. Never substitute a public
remote source or credentials.
`MENTION_ENABLE_WRITES=1` opts into existing confirmed-classification corrections
at process start; it does not authorize chat sending or other collector actions.

## Checks

```sh
npx --yes pnpm@9.15.9 typecheck
npx --yes pnpm@9.15.9 check
npx --yes pnpm@9.15.9 test
npx --yes pnpm@9.15.9 audit
npx --yes pnpm@9.15.9 test:e2e
```

Browser integration checks require the replacement and existing source to
be running. Live writes in browser tests are intercepted with synthetic responses. macOS uses installed Google Chrome; `MENTION_CHROME` overrides its
path. Other systems can install Playwright Chromium. Tests never save live edits.

## Performance boundary

The overview and conversation list now read a durable, rebuildable public projection
at ignored `runtime/public-read-model.db`. Overview counts/highlights are prepared
outside page requests. Conversation filters, counts and keyset pagination run in
SQLite and decode only the requested page. A web restart serves the last committed
generation immediately while the existing public collector API refreshes it in the
background every 30 seconds (one in-flight rebuild). The overview shows the actual
aggregation time. Failed rebuilds retain the last successful generation; an empty
installation must complete its first rebuild before returning data.

This DB contains only the public monitoring read model. A separate read-only Python
analytics worker now opens the source DB with `mode=ro`/`query_only`, copies an
explicit allowlist of public monitoring tables into process memory and releases
the source transaction before computation. Only keyword/group settings are read;
private assistant/guide/outbox/token tables are excluded. Operational Store/Context/
Coverage constructors are never executed by this worker. All original writes,
detail/media access, deliveries and lifecycle operations remain with the collector.

The worker reuses existing quality/grouping/review/briefing rules. Public-input
fingerprints skip unchanged aggregates; room fingerprints retain unchanged episode
and grouping results when another room changes. Overview, trends, briefing and
classification listing share grouped conversations instead of regrouping for each
widget or page. Korean dates, keyword exclusions, manual corrections, evidence
signatures, saved brief versions/staleness and classification audit history remain
unchanged. One serialized worker handles these public read operations and coalesces
identical concurrent requests. Its bounded caches stay in process memory; only the
existing concise public read model is persisted under ignored runtime/.

The first generation still takes seconds. An unchanged file/audit version can
reuse a retained result immediately; otherwise reads include a public-source
snapshot/fingerprint cost (currently about a second end to end). This is not yet
row-level change-stream processing: public tables are still scanned on a read, and
a changed room can require rebuilding all its historical candidates. Explicit
refresh waits for that work. Briefing save/send/image creation and other mutations
still run through the authoritative collector and can retain its computation cost.
No automatic mutation retries or additional Kakao session are introduced.

## Project documents

- [Agent agreement](AGENTS.md)
- [Decisions and version exceptions](DECISIONS.md)
- [Development standards](DEVELOPMENT.md)
- [Migration inventory](docs/MIGRATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [UI foundation](docs/UI.md)
- [Verification and limits](docs/VERIFICATION.md)

Legacy feature documentation is at
`/Users/we/Desktop/kakao-0.4.0-analysis-20261102/monitor/README.md`.

## Active connection after preview switchover

The old dashboard HTTP/gateway/preview listeners (8766/8767/8776) and its
Cloudflare tunnel were stopped at the user's explicit request. The collector
is still the same running owner and was not restarted. The new app now uses
`CollectorTransport` with a small Python compatibility bridge over that owner's
Unix socket. It reuses the existing public data/classification contracts and
history without creating a Kakao session. The analytics worker described above
adds a separate read-only public-table snapshot; it never opens the DB for writes.

`runtime/deployment.json` records `legacyRoot` and the current public origin.
The bridge imports only the existing transport and classification adapter; no
collector entrypoint is executed. No private assistant endpoint is allowed.
HTTP adapter mode remains available for isolated tests or a running compatible
source, but the deployed preview no longer depends on the retired old web port.

```sh
./scripts/tunnel.sh start
MENTION_PRODUCTION=1 ./scripts/dev.sh restart  # load the new public origin
./scripts/tunnel.sh status
./scripts/tunnel.sh stop
```

The new tunnel targets only port 8790 with the expected Host header. Existing
unrelated tunnels and private workers are not managed by these scripts. Public
refresh and monitoring writes are restricted to configured origins; delivery and
backup actions retain local-only scope. Quick-tunnel addresses are temporary and can change when
recreated. The old Cloudflare address is retired.

Design system: [rules and component ownership](docs/DESIGN-SYSTEM.md), with a synthetic interactive catalog at `/design-system`. All UI changes must actively use it.

## Continuous sentiment review

A separate bounded AI review queue classifies pending target context and future
arrivals using retained monitoring evidence. It preserves human decisions, publishes
AI attribution and concrete reasons, and rechecks changed AI context. Procedural
questions and promotional notices are judgment-excluded rather than neutral.
See [classifier operation and rubric](docs/SENTIMENT-CLASSIFIER.md). Runtime
snapshots, queue state and model outputs remain private under ignored runtime/.

## Processing service boundary (2026-11-11)

The existing private collector.sock now routes dialogue operations to a dedicated
open-chat processing server and public collection/analysis to a separate worker.
Both share the same live Kakao connection owner and retain the existing monitoring
SQLite and request contracts. This web app's source URL/socket, settings and
classification workers are unchanged. The operator verified that guide service
remains available during analytics replacement; processing changes need no Kakao
login. Physical monitoring DB failure/lock contention remains shared.
