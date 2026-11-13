# Authoritative evidence migration

The PostgreSQL evidence backend owns saved conversation detail, guarded
classifications, original expected tokens, notes and local correction receipts.
MONITORING_EVIDENCE_BACKEND=postgres selects it independently of the public
projection backend. The projection worker then builds completed read models from
PostgreSQL evidence; it does not fetch the old web server in this mode.

The import-evidence role supports a private EVIDENCE_IMPORT_FILE JSONL snapshot.
The first record is {kind:metadata,dataset:...}; following bundle records contain
{detail,classifications}. Optional audit records contain a fixed provenance source
and the unmodified original record. All conversation IDs must be unique and match
the header before active membership is published. Partial imports stay inactive;
existing active data remains available. Import cannot overwrite a locally corrected
record. JSONL is a migration input, never a public upload or request-time reader.

Expected tokens are preserved, and classification options remain the authority
when legacy detail omitted its token/stale state. Inconsistent summary, supplied
token or nonstale label changes fail validation. Human history and stale decisions
are not silently converted into neutral or fresh AI decisions.

Corrections commit detail, label, note, evidence revision, append-only audit and
receipt in one transaction. Replaying an identical request returns its receipt;
reusing its UUID with changed content conflicts. An archived legacy request ID
cannot cause another execution; its state is available through the local request
state endpoint. AI publications require literal saved evidence and cannot overwrite
human labels. The web mutation scope/Origin checks remain in force.

## Populated verification checkpoint

The first private snapshot imported741 conversations,14220 saved context messages
and953 target classifications. Comparing every normalized saved detail and
classification against the input found zero mismatches. These counts identify a
bounded snapshot, not a claim that later live messages have already been migrated.
Full original review/receipt audit import is a separate verification step.

This completes neither all management/forum/dialogue features nor public routing.
Do not switch the shared URL until populated feature parity and controlled worker
handoff are verified. Native owner login/restart is not part of this migration.

The follow-up imported4249 original review/receipt audit records. A second complete
input-to-PostgreSQL comparison still found zero mismatches across741 conversations,
14220 messages and953 classifications. Kernel-confirmed development-VM OOM was
resolved by increasing its memory from3GiB to6GiB; the existing volume survived.
Actual `pnpm verify:full` then passed in80seconds (31 unit and29 integration tests,
shared image build, Compose and transport checks).

A real staging API was started with its legacy source deliberately unreachable
(http://127.0.0.1:1), writes disabled and PostgreSQL evidence enabled. Populated API
samples succeeded: conversation list26.5ms, detail19.3ms, classification options
10.2ms, classification list11.4ms and overview9.5ms. These are single local samples,
not a production latency guarantee. The staging API was stopped after the check.
The one-shot Node projection role also completed using PostgreSQL-only evidence.

Remaining work includes complete forum/management/dialogue parity, raw native
message normalization, item7's persistent worker/view integration, a final source
delta/receipt reconciliation and operational routing/worker handoff. AWS connection
details are still pending. No public cutover is claimed by this checkpoint.
