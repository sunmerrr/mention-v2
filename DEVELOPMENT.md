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
