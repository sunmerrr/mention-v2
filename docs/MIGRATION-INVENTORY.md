# Mention migration inventory

Authoritative current feature inventory:
`/Users/we/mention/docs/MIGRATION.md` and `docs/FEATURE-PARITY.md`.
Existing source remains intact, including its uncommitted parallel work.

| Capability | Target owner / preservation requirement |
| --- | --- |
| Overview / trends / briefs | Nest application queries plus PostgreSQL read model; verify current KST scope, summaries and origin-aware counts. |
| Conversation lists/details | Cursor and filter equivalence; context expansion, photos, source IDs and quality annotations preserved. |
| Classification / review / notes | Expected evidence, human priority, request UUID, durable receipt and audit semantics. |
| Keywords / exclusions / aliases | Canonical target grouping, async revision semantics and promotion filtering. |
| Room / guide management | Native room identity; analytics exclusion independent of response/capture permissions. |
| Downloads / photos | Permission and content-type preservation; private/local boundaries retained. |
| Campaign / response / brief delivery | Local-only rights and original idempotent request identity; unknown delivery never blindly retried. |
| Coverage / backups / operations | Actual gap uncertainty and verified restore behavior; no automatic source writes in GET. |
| Continuous AI classification | Existing worker/session remains authoritative until an explicitly verified ownership handover. |
| Kakao SDK / connection / private assistant | External existing owner retained; web migration cannot create a parallel client or restart it. |

The first integration slice will be read-only against the existing compatible
web contracts. It must be visibly labeled a compatibility adapter; database and
write migration remain separate, tested stages. No native transcript or runtime
DB is copied into this repository. Only synthetic fixtures may be committed.
