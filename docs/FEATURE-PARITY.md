# Monitoring feature parity — 2026-11-06

All legacy monitoring menu entries now exist in the replacement application.
Views are native React/Radix, server-rendered on direct visits and hydrated for
client navigation. No iframe, retired dashboard listener or legacy browser-script
replay is used. The existing collector owns all monitoring data and Kakao traffic.

| Capability                | Replacement          | Preserved behavior                                                                                     |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| Sentiment                 | `/`                  | Scope, target/alias disclosure, confirmed attribution, selected reaction examples                      |
| Dated trends              | `/trends`            | Date range, target, deltas, stance counts, source evidence                                             |
| Conversation list         | `/conversations`     | Cursor paging, target/date/stance filters, concise summaries                                           |
| Conversation context      | `/conversations/:id` | Keyword highlights, photos, previous/next expansion, relevance, undo, source episodes                  |
| Source/observation detail | `/episode?id=…`      | Quality/meaning/reaction review, feedback topics/stance, review undo, campaign stop                    |
| Classification review     | `/reviews`           | Published-label edits, notes, evidence revision guard, AI/human origin and history                     |
| Message records           | `/messages`          | Date/room/text search, photos, stable history cursor, JSON and daily CSV                               |
| Keyword settings          | `/keywords`          | Include/exclude patterns, manual groups/kinds/aliases, suggestions and rule test                       |
| Room selection            | `/rooms`             | Search/state/page filters, bulk analysis include/exclude, one-minute refresh                           |
| Guide settings            | `/guide`             | Compact list, per-room capture/respond/name/keyword/reference editing and recent records               |
| Reaction observation      | `/campaigns`         | Already-sent question registration; local direct send with durable pending request ID                  |
| Question comparison       | `/responses`         | Up to six observations, confirmed/annotated reaction and topic evidence                                |
| Briefing                  | `/briefing`          | Day, saved revision/staleness/history, image download, existing local text/image delivery and schedule |
| Important conversations   | `/bookmarks`         | Source add/edit, category, owner, state, notes, archive/restore and search                             |
| Alias candidates          | `/aliases`           | Evidence, apply to target, dismiss and reconsider                                                      |
| Collection and backup     | `/operations`        | Gap pages, recovery evidence, backup list/create and isolated restore verification                     |

Legacy `/conversation?id=…` links redirect to the native conversation detail.
Photo, daily message/context CSV, briefing PNG and results.json URLs remain valid.
Analysis exclusion is not changed implicitly by guide settings. The private
assistant API/storage and collector lifecycle remain outside this UI.

## Verification

- TypeScript strict, Biome and production client/SSR builds pass.
- 23 unit/contract tests cover read normalization, pagination, SSR, classifiers,
  action origin/local guards, denied private/lifecycle routes, upstream errors,
  binary bytes and committed-write/failed-refresh behavior.
- Seven browser tests cover SSR without JS, hydration without duplicate initial reads,
  repeated client navigation, mobile fit, and intercepted settings/guide saves.
- The uncertain-send browser test intercepts every send, reloads the page and
  confirms the identical payload/request ID is reused with the draft locked.
- Live read-only smoke checks returned 200 for every menu and selected source and
  conversation details; console page errors were absent. Both daily CSV formats
  and JSON returned retained data. Public SSR was populated, carried local=false,
  and rejected a forged-local-origin send request with 403.
- The same collector PID 56231 and service instance remained connected/monitoring
  across web-only deployments. No collector restart/login, private reactivation,
  schedule/recipient/worker change or manual pending processing was performed.

No real message was sent, user classification/settings changed, or multi-GB backup
created/restored merely for a test. Those UI mutations were checked against
synthetic adapters or intercepted browser responses, preserving the existing live
validators and receipts. A connected collector does not establish complete history
recovery. Source API cold reads remain expensive (observed overview/trend about
4 seconds, briefing about 7 seconds); this restoration does not claim query-cost
optimization or a replacement database. The public URL is still a temporary tunnel.
