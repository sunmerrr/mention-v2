# Build, verify, release and rollback

## Current operation

Production still uses the existing managed local web process and Cloudflare tunnel.
No container replaces it in this change. The sole Kakao owner and processing/AI/
private-assistant workers are outside this repository's deployment lifecycle.

Use the pinned package manager from package.json:

```sh
npx --yes pnpm@9.15.9 install --frozen-lockfile
npx --yes pnpm@9.15.9 verify:full
```

`verify` runs type checking, repository lint, unit/contract tests and production
client/server builds. `verify:full` adds hermetic browser tests and release-definition
checks. Browser tests use synthetic evidence on isolated port8798 through the
managed script; no real message, setting or classification is changed.
The existing broader operator browser suite is separately available as
`pnpm test:e2e:live`; its live integration requirements have not been hidden.
Legacy-source parity tests run locally when `MENTION_LEGACY_ROOT` or the private
deployment config supplies compatible source. Public CI skips those tests when
that source is unavailable; CI success is not proof of native collector parity.

## CI and immutable artifacts

`.github/workflows/verify.yml` verifies changes, then builds the single `web`
Docker target. It health-checks the exact image and exports
`mention-web:<full commit SHA>` as an image tar plus SHA256 checksum. PR jobs never
deploy. No registry, cloud account, notification webhook or remote host is created.
Workflow execution itself occurs after the definitions are committed/pushed.

Production dependencies are separate from development dependencies; tsx is an
explicit runtime dependency because the API entrypoint executes TypeScript.
The runtime is non-root, uses an exec-form command and has a35second stop allowance,
longer than the application's25second drain deadline. Build metadata is the only
build argument; deployment settings enter at runtime.

## Container integration boundary

The image can use the existing compatible HTTP adapter only after its source URL
has been deliberately configured. `127.0.0.1` inside a container is not the Mac host.
The retired legacy TCP ports must not be restarted for this purpose.
A populated container deployment requires a separately verified source integration.
The current macOS collector socket, source Python environment and filesystem cannot
be assumed portable into a Linux container. Never bake them, their credentials,
state or private records into an image. The health smoke proves only web liveness,
not monitoring parity or ability to save/send.

There is no Docker executable on the current development Mac. Docker build, actual
Compose expansion and container termination remain CI/runtime checks, not locally
verified outcomes. Release-definition static checks report this distinction.

## Promotion and rollback (prepared, not executed)

Keep the last50 approved immutable images/checksums in the chosen artifact archive;
GitHub's30day CI retention alone is not that archive. No archive/registry has been
provisioned here. Use one tested image for local/QA and production; never rebuild
with environment values or use `latest`.

1. Download the successful CI image and checksum; verify with
   `sha256sum -c mention-web.sha256`, then `docker load -i mention-web.tar`.
2. Prepare `apps/deploy/.env` from its example, with an explicitly validated source
   integration and writes disabled. Do not commit this file.
3. Inspect the planned configuration:
   `docker compose -f apps/deploy/local.yml config`.
4. On an authorized Docker host, stage the existing artifact with
   `python3 scripts/deploy-image.py local mention-web:<full SHA>`.
5. Verify populated data, permission scope and required source compatibility.
   A production cutover needs the user's final approval of that concrete result.
6. Promote the same artifact with `production` after that approval. The current
   host8790 must first be deliberately handed over; never start both there.
7. Rollback uses the same command with the previous approved image. Failed health
   checks automatically restore the previous env/image when one is recorded.

Deployment is serialized by an environment lock, has no build/pull/login operation,
checks the reported build identity, and retains metadata-only history under ignored
runtime/. It refuses a first rollout with writes enabled. Schema/data migrations
are not part of this release. No script performs Kakao reconnects or unknown-send
retries. A failed deployment with no previous image needs operator intervention;
it is never reported as rolled back successfully.

## Operational diagnostics

`/health` reports only process role/build/status; it never checks Kakao or DB state.
Web 5xx metadata is retained in ignored `runtime/system-errors.db`, table
`system_error_logs`. Records contain UTC time, method, route template and status;
no body, raw URL query, message text or exception text is retained. Pino continues
to write structured process logs. During a drain, accepted work finishes first;
a25second timeout is a failed exit and must be reconciled from durable write
receipts. A restart is not permission to retry an uncertain operation.

## Proxy timeouts

Origin keep-alive is configured by `HTTP_KEEP_ALIVE_TIMEOUT_MS` (default970000ms),
with headers timeout derived as keep-alive plus10000ms. This retains the reference
ordering without changing/restarting the tunnel or enabling proxy trust. The
current chain includes cloudflared, whose origin idle setting is a separate hop;
see [Cloudflare origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/).
No reduction in edge502/520 rates is claimed without operational trend evidence.

## Dependency addition

Dayjs1.11.23 is pinned, MIT licensed, and used only for UTC/KST boundary operations.
The production dependency audit reported zero advisories after installation.
The existing Intl display formatting remains explicitly KST. Native numeric epoch
message contracts and stored collector records have not been rewritten.
