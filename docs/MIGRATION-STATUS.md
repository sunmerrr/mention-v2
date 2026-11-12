# Migration checkpoint — 2026-11-12

## Implemented and verified

- Company common core copied at the recorded upstream SHA; original and existing
  production workspaces remain untouched.
- User-approved security update. Production audit:0advisories. Development tree:
  one documented unpatched low-severity tool dependency advisory.
- Actual `pnpm verify` passed on Node24.14.0/pnpm9.15.9: lint/build,6unit tests,
  8API integration tests. Full output retained privately under `.dev/tmp/`.
- NestJS monitoring controller/service/repository and shared Zod query schemas.
- Read-only overview, paginated conversations, conversation detail and
  classifications. Public-only transition reads; no SDK, native login, source
  write or outgoing-chat path.
- Source redirects are rejected; malformed errors do not leak source text;
  invalid filters are rejected before source access. Health is independent.

## Real read-only comparison

Started only the new API via the prescribed lifecycle script on4200, compared
six actual reads against the running Mention8790service, and stopped the new API
with that same script. All six returned identical decoded data, including
classification origin/staleness/evidence tokens and pagination. Only hashes and
counts are retained in `.dev/tmp/live-read-parity.json`, not transcripts.

Kakao owner14379, analytics63074and dialogue63112remained unchanged. The active
8790web and public tunnel were not restarted. No settings, stored classifications,
sends, receipts, schedules or worker sessions were changed.

## Not completed or deployed

- PostgreSQL schema/import and persisted-query verification.
- Full monitoring UI/SSR migration into the company workspace.
- Guarded writes, local permission boundaries and receipt-owner handover.
- Worker/Valkey integration, authentication selection, Docker/CI rollout.
- Production database or web cutover.

The new API is a tested transition slice, not a claim of completed platform/data
migration. The company boilerplate's example pages are not the migrated dashboard.

## Next required environment

No Docker, container VM or PostgreSQL executable was found on the current Mac.
The user has been asked whether to prepare local verification infrastructure or
use a company verification environment. No installation or remote target is
assumed from silence. PostgreSQL/testcontainers/verify:full require that environment.
No separate feature-reference repository is required or awaited.
