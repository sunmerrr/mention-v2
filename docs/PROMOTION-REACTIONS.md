# Excluded-ad reaction contract

User-authorized analytics capture, implemented on2026-11-12. The native analytics
worker owns the policy and additive `promotion_reaction_links` metadata table;
see the collector's monitor/PROMOTION_REACTIONS.md. The dashboard adapter reads
this table only through its public disposable snapshot and native detail API.
It never inserts chat messages or controls native authentication.

`Message.promotionReference` preserves native ad identity/time, configured target
keywords, target names, `explicit_reply` or `topic_candidate`, and target ambiguity.
It contains no ad body or attachment. The UI identifies native replies and weak
candidates, and uses a reaction-phase label when there is no literal keyword hit.
Inherited subject metadata never increments literal keyword-occurrence counts.
Classifiers must preserve attribution uncertainty instead of treating every listed
brand as positively/negatively evaluated. Actual reaction text remains unchanged.

The optional projection table is backward compatible with pre-migration databases.
Excluded-room filtering applies to its rows. Native source signatures include
reference metadata only for new reference-bearing messages, preserving historical
signatures and human reviews. Current keyword ownership remains authoritative.

Synthetic regression coverage includes source matching/order/windows/isolation,
metadata-only persistence, restart,15meaningful messages per side, public transport,
SSR labels, and desktop/mobile browser display with all mutation requests blocked.
Operational validation is separate: analytics was replaced while the existing
connection-owner PID/instance and dialogue worker were preserved. Native live
response capture must be verified on a naturally arriving event; no test message,
old-history recovery, duplicate worker or new login is required or performed.
