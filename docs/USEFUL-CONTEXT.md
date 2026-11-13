# Useful context collection — item7

## Approved behavior

Each anchor needs15 useful messages before and15 after. Each presentation
expansion adds15 on the chosen side, so expanding both sides once reaches60
surrounding messages when evidence is available. Anchor messages are separate
from those quotas. Collection is worker work; SSR/API expansion must read stored
PostgreSQL evidence without calling the native owner.

The current Node policy lives in modules/context/useful-context.ts. It is a port
foundation, not yet wired into the production Python worker or public routes.
Do not infer operational activation from passing synthetic tests.

## Evidence and counting

- Filter native system/entrance events, greetings, empty reactions, media without
  literal substantive commentary, pure links, registration templates and
  conservative promotion templates before counting.
- Preserve short opinions and actual questions. Length alone is not a filter.
- Deduplicate native room/message identity. Collapse consecutive identical text
  from the same author, but preserve independent authors expressing agreement.
- Preserve original raw evidence separately; excluding a row from the useful
  quota does not authorize deletion or invent a relationship with the anchor.
- Count nearest-first per direction. Preserve exact native IDs using decimal
  strings and BigInt comparisons rather than JavaScript Number.
- Keep explicit unrelated/noise decisions out of the quota. Nearby conversation
  remains a context candidate, not automatically a reply or confirmed opinion.

## Source adapter contract

A source reads nearest-first using an exclusive native log-ID cursor and must
honor its requested limit. Pages are checked for room/direction/order. A quota
can be reached partway through a page; resume from the last consumed message,
not the unread page end. This prevents silent message loss on the next click.

Workers supply explicit maximum pages and scanned rows. Stopping reasons are
quota, verified end, source gap, page limit, scan limit or stalled cursor. Only
a verified end justifies exhausted=true and hiding a completed direction button.
A gap/budget stop means coverage is incomplete; it must not be displayed as
no older/newer conversation. Future live arrivals can extend an after boundary.

## Pending integration

The PostgreSQL StoredContextSource is now implemented and indexed by native
identity and room/time. It honors explicit time bounds, nearest-first direction,
exclusive consumed-message cursors and per-conversation manual unrelated/noise
decisions. Source messages retain own/time/reply provenance. Integration tests
verify15 useful messages independently in each direction and the next15 without
skipping the unread remainder of a page. Noise and another room do not consume
the quota. A stored-data boundary reports a gap and shortage, never a verified
native-history end. These checks passed in the actual full verify with51 unit
and51 integration tests, including the common image/Compose checks.

Persist normalized source evidence and per-anchor coverage/cursors in PostgreSQL,
wire worker scans to the Node policy, and replace the transitional native web
expansion adapter with DB-only pagination. Preserve human relation/review edits
and distinguish quota shortage from relevance uncertainty. Do not activate a
parallel production history consumer during migration testing.

Owner-local durable buffering/retention is item8-1 and remains deferred.
