# Server consolidation checkpoint

## Approved target

- Keep only the existing Kakao connection owner and Chrome extension on the Mac.
- Mac-initiated reverse SSH exposes an owner proxy socket on the AWS Docker host.
  Containers mount the dedicated host directory, not an individual socket inode.
- One TypeScript/NestJS project, one application image, shared Drizzle models and
  PostgreSQL16. SSR/API, ingestion, dialogue and aggregate/schedule are distinct roles.
- PostgreSQL starts inside the stack; DATABASE_URL keeps managed-DB migration possible.
- Web pages read completed materializations and never initiate native collection.
- No source keyword propagation to host programs; browser discovery/search policy
  remains separate from server matching policy.

## Implemented in this checkpoint

- Node Unix-socket RPC compatibility for owner status/event reads. No login,
  owner shutdown or send RPC exists in this adapter. Untagged unsafe JSON integers
  and tagged64-bit native IDs retain exact decimal identity.
- PostgreSQL Drizzle intake tables: offsets, original events with per-event native
  wire evidence, and explicit owner coverage gaps. A session advisory lock fences
  duplicate consumers; raw evidence and the cursor commit in one transaction.
- Ingestion starts OFF. First attachment requires an explicit cursor; a changed
  owner cannot reset that checkpoint silently. Socket failures retry only reads
  from the committed cursor, without authentication or send replay.
- One api Docker target now includes SSR assets; separate nginx/web images are no
  longer selected by verification. In-stack PostgreSQL Compose and lenkins custom
  BuildConfig preparation use one application image reference for api/worker/
  ingestion/migration. APP_ROLE=migrate and worker one-shot entrypoints are explicit.
- Reverse SSH helper builds a dedicated foreground SSH invocation, preserving host
  key checking and refusing implicit socket replacement. It does not provision
  EC2, change security groups or start automatically.

- The Node extension receiver persists raw posts/comments and durable acceptance
  receipts in PostgreSQL before matching. Collector identity and command leases
  are scoped independently of web settings; expired commands become unknown and
  are never replayed automatically. A separate configurable collector hostname
  exposes only the v1 prefix through lenkins. Actual DNS/ALB setup is pending.

## Local production

On 2026-11-24 the existing public URL cut over to the Node SSR/API in the
`mention-live` Docker host. Its ingest and worker roles read the forwarded owner
socket and share PostgreSQL with the API. The old Mention web, analysis worker
and extension receiver processes were retired. See the [migration record](MIGRATION-STATUS.md)
for the frozen data counts and live intake checks.

The OpenChat service, private assistant and Kakao connection owner remain
independent. AWS still requires a destination host, a dedicated SSH identity
and a remote socket directory. The owner durable buffer remains a separate task.

The Mention worker skips duplicates, promotions, greetings and short reactions
when selecting context. It seeks 15 useful messages per direction when enough
are available. Further context is served from PostgreSQL in 15-message increments.

## Reverse SSH usage

On the Mac, configure MENTION_SSH_TARGET, MENTION_LOCAL_OWNER_SOCKET and
MENTION_REMOTE_OWNER_SOCKET in a private environment file. The remote directory
must already exist and belong to the dedicated SSH user. APP_UID/APP_GID must allow
that same user to access the socket inside the ingest container. The host stack
mounts only this dedicated directory read-only; that does not make socket RPC
read-only, which is why the API container receives no socket mount.

Use `node --env-file=PRIVATE_FILE scripts/reverse-ssh.mjs --dry-run` to review the
invocation. `--run` is explicit, uses existing SSH authentication and keeps the
process in the foreground for a host supervisor. A failed bind does not unlink an
existing socket. A stale proxy must be reconciled after confirming the owning
SSH connection ended; never delete or replace the Mac owner's actual socket.

## lenkins setup

The BuildConfig and Compose listener labels follow the [lenkins build guide](https://lenkins.teamlulu.ai/build-guide.md).

Register the project repository and one custom BuildConfig using lenkins.yml:
context root, Dockerfile apps/deploy/Dockerfile, target api, linux/arm64 and tag
prefix mention-server. Select the actual administrator-provided ECR repository;
none is guessed in lenkins.yml. Host-stack image mapping is
IMAGE_TAG_MENTION_SERVER -> mention-server. Inject ECR_REPOSITORY and other runtime
values through the private host-stack .env.

The prepared Compose stack is apps/deploy/docker-compose.yml. It has PostgreSQL,
one-shot migration and api/worker/ingest services sharing the app image.
The API listener is runtime-configured. AWS exposure, target ports and ALB
security groups are configured when deploying that stack.

## Verification

Use `pnpm verify:full`. This includes synthetic socket tests, a disposable real
PostgreSQL intake transaction/lease/gap suite, all existing projection/API tests,
the sole application Docker target, both Compose definitions and reverse-SSH
argument checks. Tests never access the live owner socket or production database.
Keep full logs under .dev/tmp and report actual results separately from this plan.

### Verified checkpoint — 2026-11-13

`pnpm verify:full` passed in68seconds after the forum state/control and useful
context changes:24 API unit tests (including111 portable validation cases inside
one fixture test),24 real PostgreSQL/API integration tests, client/SSR/server
builds, the shared app Docker target, local/server Compose validation and reverse
SSH argument checks. Full output: ignored
.dev/tmp/server-forum-context-final-verify.log. No production receiver or native
connection was used by these tests. This validates the checkpoint, not a completed
independent deployment or item7's production integration.
