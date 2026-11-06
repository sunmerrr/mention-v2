# Architecture boundaries

Proposed layout, to be filled by verified vertical slices:

```
apps/web/src/                 React routes, components and SSR/client entries
apps/read-api/src/            Lightweight web-facing query endpoints, if needed
packages/domain/src/          Pure product types and rules
packages/application/src/     Use cases and narrow read/write ports
packages/contracts/src/       Versioned transport DTOs and validation schemas
packages/ui/src/              Selected component-system integration and tokens
docs/                        Decisions, migration and verification evidence
```

Domain and application code must not import React, HTTP clients, SQLite or Kakao
SDKs. Avoid introducing a separate service merely because the folder exists.
The existing collector stays the only owner of the Kakao connection and monitoring
DB writes. Its integration adapter preserves public/local request scope.

## Read contracts

- Overview: selected-period aggregates, target counts, classification coverage,
  comparison period and collection coverage; no transcript arrays.
- Conversations: cursor + capped limit + filters; concise previews, stable IDs,
  next cursor; no full context for every row.
- Conversation detail: only the chosen conversation's context, attribution,
  available range and evidence version.
- Classifications: cursor-paged confirmed labels with origin, revision and notes.
- Classification edit: expected evidence/revision and stable request ID, returning
  the saved revision; preserve previous values, reject conflicts, do not auto-retry
  uncertain writes under a new identifier.

A facade that fetches the legacy ~945 KB response and slices it is only a temporary
compatibility adapter. It is not the completion of backend pagination or latency
work. Prefer precomputed/query-efficient read models inside an explicitly designed
boundary, without adding an uncoordinated production SQLite writer.
