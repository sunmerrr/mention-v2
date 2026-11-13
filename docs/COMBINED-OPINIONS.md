# Cross-source opinions

`/combined` compares Kakao conversation groups and retained Pokergosu posts with
comments. Date and canonical target filters apply to both. Dates for forum content
use publication time in Korea, never ingestion time; undated posts are disclosed
and omitted from dated results. Counts are not pooled across unlike units.

Canonical target and alias settings live in the existing native settings
transaction as `keyword_policy`. Legacy settings retain the effective Kakao
subset. The forum settings adapter uses its independent effective subset and
continues to ignore Kakao exclusions. Missing policy preserves legacy shared
keyword behavior. Reading never creates a policy; an actual settings save does.
Concurrent policy edits fail with409. Existing source-only alias tools preserve
the other source's scope.

Forum opinion reviews are separate from Kakao review identities. Reviews contain
target ID, original-source signature, verdict, summary, actor and revision.
Request receipts and review history are committed atomically. Human changes take
priority over AI; changed retained context requires a fresh verdict. No automatic
forum AI classification worker or new crawler schedule is enabled by this feature.

Common-topic examples are extracted from reviewed summaries for the same target,
with links to each source. They are bounded examples and do not imply equivalent
sentiment, exhaustive topic coverage, or agreement between sources. Missing and
unclassified evidence remains explicit.

Source-only deployment is intentional: this feature remains part of the current
public source bridge. The company migration preview requires matching forum and
combined endpoints, review persistence and source-policy guards before cutover;
this feature is not a claim that those PostgreSQL migration gates are complete.

Verification: `runtime/combined-verify.log` retains the full pnpm verify output;
`runtime/combined-browser-tests.log` covers SSR, hydration, mobile and synthetic
review saves. Production QA is read-only. Native monitor tests pass253; integrated
718 has the existing timestamp-sensitive `456` log assertion failure, independent
of keyword changes. Processing deployment preserves the live connection owner and
dialogue worker. Forum receiver replacement does not issue browser control or
start/resume/reload a crawl. No test message or production verdict was written.
