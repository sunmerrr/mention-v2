# Mention

React SSR replacement for the Kakao open-chat sentiment and trend dashboard.
Workspace: `/Users/we/mention`. Legacy service remains separate and unchanged.

## Implemented first slice

- Native React SSR and hydration with the same component tree, without jsdom.
- Client-side navigation with React Router and route-level lazy loading.
- Radix Themes components for buttons, selects, tables, cards, popovers and dialogs.
- Sentiment overview, date/target filters, cursor-paged conversations, selected
  conversation context, and confirmed-classification review/correction UI.
- Thin public read adapter to the existing service, validation and request
  coalescing. Upstream data is normalized into separate summary/list/detail DTOs.
- Correction validation and upstream conflict forwarding, disabled by default in
  the running preview. No automatic mutation retries.
- Request-scoped SSR query clients and TanStack hydration without duplicate reads.

The preview runs at **http://127.0.0.1:8790/**. The origin is loopback-only and read-only. A user-authorized Cloudflare quick tunnel now exposes this new preview; see `runtime/deployment.json` or `./scripts/tunnel.sh status` for its current URL.
It is not a production cutover or a migration of all fifteen legacy screens.

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
`http://127.0.0.1:8766`). Never substitute a public remote source or credentials.
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

Browser integration checks require the read-only preview and existing source to
be running. macOS uses installed Google Chrome; `MENTION_CHROME` overrides its
path. Other systems can install Playwright Chromium. Tests never save live edits.

## Performance boundary

The browser receives only the summary and first cursor page. It does not download
all transcripts and hide most rows. However, the compatibility adapter still
fetches/normalizes the legacy full response on a cold read and keeps a public-only
30-second snapshot in memory. Stale snapshots remain available while a single
refresh runs. Warm latency measurements do not establish cold-query performance.
Source-query pagination/materialized read models remain a separate milestone.
The explicit refresh action waits for a fresh source result; no speculative API
prefetch, focus refetch, or default polling has been added.

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
history without opening a monitoring DB connection or creating a Kakao session.

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
refresh is restricted to the configured origin; the preview still rejects all
classification writes. Quick-tunnel addresses are temporary and can change when
recreated. The old Cloudflare address is retired.
