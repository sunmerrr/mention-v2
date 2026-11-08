# First-slice verification — 2026-11-06

## Scope

Local production-build preview at 127.0.0.1:8790, with existing legacy HTTP service
as its public monitoring source. Initially this was a local-only preview; the user subsequently requested the public switchover described below.
No legacy service restart, Kakao login, token move or production edit was performed.
The existing collector PID 53735 remained connected during verification.

## Automated checks

- TypeScript strict typecheck and Biome recommended lint/format checks.
- Fifteen Vitest tests: per-target classification semantics, unknown/stale handling,
  cursor traversal with tied timestamps, cursor/filter mismatch, capped DTOs,
  protected writes, origin checks, SSR content/query isolation and the adapter.
- Three Playwright integration tests: populated HTML without JavaScript,
  hydration with zero repeated initial API reads, native client route transitions,
  classification edit/cancel dialog, selected context, filters and mobile bounds.
- Client and server production builds complete.
- Dependency audit: zero reported info/low/moderate/high/critical vulnerabilities.
  Exact dependency versions and pnpm lockfile retained.

## Observed local warm snapshot measurements

| Route                          | Response time | Uncompressed body |
| ------------------------------ | ------------: | ----------------: |
| `/` populated SSR              |         79 ms |      54,909 bytes |
| `/api/overview`                |         16 ms |       2,713 bytes |
| `/api/conversations?limit=12`  |          4 ms |       5,503 bytes |
| `/reviews` populated SSR       |         46 ms |      50,399 bytes |
| `/conversations` populated SSR |         29 ms |      39,099 bytes |

Measured on the current Mac with warm, public-only adapter data. Native production
HTTP compression is enabled and was tested with decoded, nonempty HTML. Core
monitoring records were not copied into source fixtures. Screenshots and raw
measurement/audit output are development artifacts, not committed transcripts.

## Limits

- A cold first upstream read still takes seconds (one observed cold SSR about
  3.75 seconds). The adapter's 30-second shared public snapshot reduces repeated
  query work; it does not optimize the legacy DB grouping algorithm.
- Cursors limit new API/browser responses over the snapshot. They are not proof
  of cursor-limited SQL execution in the source service.
- The new app requests no private assistant data or local-only send operations.
- Classification corrections are tested with synthetic ports; the running preview
  blocks writes. Real edits are neither necessary nor claimed for verification.
- The other legacy management and delivery pages are not migrated.
- React Router's security-patch major exception requires ongoing navigation tests;
  a passing first slice is not proof of every future route/form combination.

## User-requested preview switchover

- Retired only the old Mention web process, gateway, AI preview and tunnel.
- Confirmed ports 8766, 8767 and 8776 are closed, with the new port 8790 open.
- Confirmed collector PID 53735 and its service identity are unchanged/connected.
- Replaced the HTTP read dependency with a read-only collector-socket bridge.
- New public overview/classification pages return current data with the old HTTP
  server stopped. Public origin validation for refresh was exercised successfully.
- All three browser integration tests also passed through the new Cloudflare URL,
  including JavaScript-disabled SSR, repeated navigation, context and mobile bounds.
- New preview remains read-only; full legacy feature parity remains incomplete.

## Subsequent full monitoring UI restoration — 2026-11-06

The read-only/four-screen statements above describe the initial slice. All
monitoring menus, source details and existing actions/exports are now connected
in the replacement. Monitoring edits are enabled in the deployed instance.
Current verification: strict typecheck, Biome, production build, 23 unit/contract
tests and 7 browser tests pass. Live read/download smoke and public-scope checks
passed; sends/settings writes in browser tests were intercepted. No real message
was sent, no user classification was edited, and no backup was created merely to
test the UI. Collector PID/service identity remained unchanged and monitoring.
See FEATURE-PARITY.md for the complete feature table and limits.
