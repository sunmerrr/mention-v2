# Mention design system

This is the required UI foundation, not an optional reference. Start every UI
change here. The implementation lives in `apps/web/src/design-system` and the
interactive, synthetic-only catalog is available at `/design-system` (not in the product menu).

## Ownership and layers

1. `tokens.css`: semantic color, spacing, typography, radius, shadow and layout
   tokens. Radix primitive scales remain the underlying source. Product CSS uses
   `--mention-*` for shared visual decisions; change definitions centrally.
2. `theme.tsx`: one light Theme configuration shared by SSR and hydration, plus
   the sentiment palette. No browser-dependent theme selection during rendering.
3. `primitives.tsx`: the only vendor control import boundary (along with the theme).
   Reuse Radix controls rather than reimplementing keyboard/focus/portal behavior.
   Button adds action intent and Card owns the default surface. Other controls
   retain Radix APIs through named reexports; they are not separate implementations.
4. `patterns.tsx`: PageHeader, Section, FilterBar, Field and DialogContent compose
   recurring product layouts. Extend these when the same arrangement is needed
   again. Product concepts such as conversation evidence remain outside this layer.

## Tokens and decisions

| Role                               | Semantic token / scale                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Page / content / subtle background | `bg-canvas`, `bg-surface`, `bg-subtle`                                    |
| Text / secondary / action          | `text-primary`, `text-secondary`, `text-action`                           |
| Border / subtle border / focus     | `border`, `border-subtle`, `focus`                                        |
| Sentiment                          | `positive`, `negative`, `neutral`, `mixed`, `uncertain`                   |
| Space                              | `space-1` through `space-7` (Radix scale aliases)                         |
| Typography                         | `font-title` (6), `font-section` (4), `font-body` (2), `font-caption` (1) |
| Shape / surface                    | `radius-control`, `radius-surface`, `shadow-surface`                      |
| Layout                             | `sidebar-width`, `content-max`, responsive `page-gutter`                  |

CSS token names are prefixed `--mention-`. In JSX use matching Radix numeric
spacing/type props; these use the same underlying scale. Avoid arbitrary new hex
colors, font sizes or spacing for repeated UI. Layout-specific values may live in
product CSS when they do not represent a shared decision. Breakpoints follow
Radix responsive props where possible; narrow-screen product layout CSS is allowed.

## Usage

```tsx
import { Button, Field, PageHeader, Section, TextField } from "../design-system";

<PageHeader title="키워드 관리" actions={<Button>저장</Button>} />
<Section title="규칙">
  <Field id="name" label="이름">
    <TextField.Root id="name" />
  </Field>
</Section>
```

Product UI copy must be Korean.
Buttons use `intent="primary"` (default), `secondary`, `quiet`, or `danger`.
Use one primary action per action group. Existing explicit Radix variant/color
props remain supported during migration; new work should prefer semantic intent.
`asChild`, forwarded refs, disabled/loading and HTML form association are preserved.
Do not wrap links in buttons or implement clickable divs as form controls.

Fields require an explicit matching control ID. When a hint is present, pass
`aria-describedby="<id>-hint"` to its input. Radix controls own focus rings;
never remove visible focus. State always includes text, not just color.
Dialogs keep Radix Root/Trigger/Close; use DialogContent for heading/description.
Classifications preserve request IDs, conflict checks, attribution and audit trails.

## Required workflow

- Search the catalog and existing patterns before adding UI.
- Import UI primitives through `design-system`; no direct Radix imports in pages.
- Add missing reusable elements here rather than styling a new variant per page.
- Add a synthetic catalog example for each new reusable pattern or state.
- Check keyboard focus, disabled/loading/error/empty states, desktop and mobile.
- Update this document and the catalog when shared decisions change.
- Run `pnpm test`, `pnpm typecheck`, `pnpm check`, and the relevant browser checks.
  `tests/design-system.test.ts` enforces the vendor boundary and token references.

## Adoption status

All current UI modules import controls through this system. Global theme and major
canvas/text/border/sentiment tokens are centralized. Overview, conversation list,
review list and management page headers use PageHeader. Filters use FilterBar;
context classification uses Section and the shared correction dialog uses
DialogContent and Field. Older feature-specific layouts still contain local
spacing and presentation rules; they are not claimed to be fully redesigned.
Convert these when modifying the relevant screen, without growing parallel styles.

The catalog uses synthetic examples only and has no write API calls. No collector,
login, responder, schedule or production classification changes are involved.

`DetailLayout` separates the primary reading column from analysis/management. It stacks below 1200px; a visible in-page link provides access to the secondary area. `Disclosure` contains optional metadata/tools. Context expansion belongs at the beginning/end of its reader, with shared busy/error state across both controls. Catalog examples cover both patterns.

`DetailLayout stickyAside` keeps the secondary panel visible on desktop above 1200px. It is bounded to the viewport with internal overflow so every action remains reachable; stacked/tablet/mobile layouts retain normal document scrolling.

EvaluationStatus is the shared product status presentation: fresh classifications use their current badge; stale evaluations show the previous decision and an explicit context-changed/recheck message. A genuinely unclassified record remains unclassified. This component does not reactivate stale results for sentiment aggregation.

SelectionPanel provides named selectable lists, a header action, page-level selection, empty content and optional pagination. Room configuration uses separate included/excluded panels with only the opposite move shown for the current selection; reporting date/count controls do not belong in this configuration flow.

MetricCard standardizes label/value/unit/description/action stacking. Overview conversations use flat rows in a Section, with optional excerpts in Disclosure rather than nested cards. Tables preserve a readable internal width on mobile and scroll within the section.

Judgment choices distinguish uncertain (insufficient evidence) from excluded (not a subject for sentiment judgment). Excluded uses a neutral badge and a dedicated state filter; it is not a sentiment color in the distribution legend. Source collection inclusion is independent.

PreviewDisclosure is a keyboard-accessible native details row with title/metadata, compact preview and an inline editor. Use it for editable collections where showing every form at once obscures the overview. Editors remain mounted so collapsed fields keep their form values. Keyword group rows allow one editor open at a time and expose add/delete at their relevant scope.

`ReadingTable` bounds the primary reading column and preserves metadata widths for
long public-source text. Its minimum width and reading-column ratio are semantic
tokens; overflow stays inside a named, keyboard-focusable region with a mobile
scroll hint. The catalog includes synthetic long text/URL evidence. Pokergosu
uses this pattern together with MetricCard, Section and the standard filter controls;
source text is escaped and rendered as text, never injected HTML or fetched media.

ReadingTable retains Radix Table.Root's existing ScrollArea. Because that root
does not expose viewport props, the named region adapts left/right keys to the
vendor viewport only when the region itself has focus and horizontal overflow
exists. This is kept at the design-system boundary; feature screens do not inspect
vendor internals or replace the table's pointer/touch scrolling implementation.

Source-image presentation separates an uncached reference, explicit loading,
retained local pixels and an unsupported/failed result. It uses standard Button,
Text and native image/link elements; the shared maximum image height is tokenized
as `source-image-max`. The catalog's reference/cache example is synthetic and makes
no network calls. Media remains contextual evidence, not a sentiment judgment.
