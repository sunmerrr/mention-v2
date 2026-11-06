# UI foundation and acceptance

The user's explicit addition: use a library or an existing implementation when
custom UI work is ineffective. Choose one coherent component system or licensed
admin template before building screens. Do not independently reinvent standard
controls and then patch their size/alignment repeatedly.

Implemented foundation: **Radix Themes 3.3.0 (MIT)** and Lucide icons. Actual
library components implement tables, selects, popovers, dialogs, buttons, badges,
text fields, text areas, callouts, cards and layout primitives. A small product
stylesheet handles shell placement, transcript formatting and sentiment bars.
No third-party admin template or proprietary reference implementation was copied.

The shadcn/Tailwind candidate was not installed; a pre-styled component system
covered the first slice with fewer bespoke component files. The date filter uses
a native calendar input wrapped in the library field. Charts beyond sentiment
composition have not been introduced without a real comparison contract.

## Reuse inventory

Use existing buttons, select/combobox, calendar/date-range controls, table,
pagination, dialog/sheet, tabs, tooltip, badge, form field, skeleton and toast.
Build product-specific components only for target sentiment, conversation context,
classification origin/history and collection coverage.

## Product layout

- A compact date/target toolbar grouped at one side, not a full-width empty panel.
- Consistent page title, section title, body and secondary text hierarchy.
- Distinct page canvas, content surface, input surface and selected state.
- Overview: meaningful changes -> target comparison -> concise source conversations.
- Classification page edits already published labels; no approval queue.
- No tiny low-contrast explanatory walls or oversized single-number cards.
- Preserve five sentiment classes; never fold unknown/unclassified into neutral.
- Keyboard focus, accessible names, loading/error/empty states and mobile overflow
  are part of acceptance, not a final polish task.

Linear is a visual reference; Sprout Social and Brand24 are workflow references.
These do not grant permission to copy proprietary implementation or assets.
