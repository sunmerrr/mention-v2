# Engineering standards

## Reference sources

- Engineering Templates: https://project-template.mygen.site/llms.txt
- Stack: https://project-template.mygen.site/#/tech-stack
- Frontend: https://project-template.mygen.site/#/frontend/build-and-runtime
- State: https://project-template.mygen.site/#/frontend/query-state-patterns
- Pagination: https://project-template.mygen.site/#/api/03-pagination

Use the guide for concrete implementation conventions and Clean Code / Clean
Architecture for maintainability and dependency boundaries. They are design tools,
not justification to ignore a user requirement or add unnecessary infrastructure.
Reference-guide version choices require compatibility checks before installation;
its architecture claims do not establish universal framework limitations.

## Clean code

Name code after product meaning: target, alias, conversation, classification,
evidence and collection gap. Keep functions cohesive and make side effects clear.
Avoid boolean-heavy interfaces, repeated policy, giant route handlers and strings
that silently encode multiple types of state. Comments explain reasons and limits.
Do not mechanically split code into tiny functions or abstract one-off operations.

## Clean architecture

Domain code owns classification values, attribution, eligibility and evidence
rules. Application use cases coordinate ports for reads and writes. Infrastructure
adapts existing collector APIs; UI displays state and invokes use cases. Dependencies
point inward. An adapter failure becomes an explicit application error; it must
never trigger a Kakao login as an implicit fallback.

Read models are deliberately separate from write behavior. Expensive collection
and context grouping must not run from scratch for every display widget. Avoid
serial waterfalls for independent requests and avoid fetching whole histories to
show twelve rows. Short-lived caches are considered only after query/index work;
cache freshness and invalidation are part of the contract.

## Rendering and state

Use the same React component tree for SSR and browser hydration. Scope server
query caches to the request. Keep public and local-only results separate. Preserve
filter state in the URL. List/detail navigation restores useful prior state without
recreating the entire document. Do not implement fake SSR by evaluating legacy
browser scripts inside jsdom or hiding a second DOM until replay is complete.

## Change workflow

1. Read decisions and the relevant guide block; identify the user-visible outcome.
2. Find an existing component/pattern and a narrow vertical slice.
3. Define contracts, failure behavior and meaningful acceptance checks.
4. Implement domain/use-case boundaries before coupling presentation to transport.
5. Test changed behavior, inspect the real UI, measure populated-state performance.
6. Document verification and remaining limitations. Deployment is a separate stage.

Keep secrets and real transcripts out of fixtures and logs. Do not copy the legacy
working tree, production state or historical test counts as proof for this project.

## UI foundation

The project design system is mandatory. Read [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md), import controls from `apps/web/src/design-system`, reuse its tokens and patterns, and update the synthetic `/design-system` catalog for new shared elements. Feature files must not import vendor controls directly.

### Keyword save/rebuild separation — 2026-11-10

The UI supports the collector's optional `/api/keyword-processing` capability.
It distinguishes committed settings, background rebuild, and failed rebuild;
404 from the currently older collector is an explicit unsupported capability,
not a false success. Poll active jobs every two seconds and idle status every
30 seconds; ordinary action invalidation refreshes status after a save.
The collector worker is staged in the separate collector workspace. This web
release alone does not remove the old collector's synchronous save latency.
No production keyword changes or collector restart were used for verification.
Synthetic tests cover revision supersession, durable interrupted export claims,
retry, live dirty-day preservation, concurrent review preservation, and saves
while export is blocked. Browser status tests intercept responses, never save
production settings. Actual deployed save latency remains unverified until an
authorized fresh-token collector replacement.

### Promotion follow-up context — 2026-11-10

Poster/GTD notice templates and bare participation invitations are background,
while numeric slash registration records are retained as background evidence.
Questions and opinions are protected from these automatic notice heuristics.
The public bridge re-annotates returned conversation evidence in memory so a
promotion with insufficient following dialogue does not claim full context.
The detail page explicitly flags this gap. Source records and human decisions
are not changed by presentation annotation. Read-model projection version7
rebuilds derived results with the same selection policy.

Prepared collector changes give new promotional anchors a fixed30minute after
window and15 dialogue candidate slots; an explicit after expansion of a poster
notice also uses30minutes. This is a bounded target, not a guarantee of15
available messages or confirmed relevance. Existing healthy collector has not
been replaced, so automatic extended capture is NOT deployed yet. No history
request, authentication, or Kakao send was used to validate this change.
