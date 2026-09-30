# Design spec

The layout and visual language, for `/to-spec`. This is deliberately light: it fixes the look and the layout, not exact placement or sizing. The decision is [Layout and visual language prototype][t15]. The primary reference is the prototype on branch [`prototype/layout-visual-language`](https://github.com/vidhatatrivedy/hive-template-importer/tree/prototype/layout-visual-language), route `/prototype/layout?variant=B`. It's a reference, not production code.

Companion specs: [functional](functional.md) (what each pane does) and [technical](technical.md).

## Layout: variant B, "Collapsing columns"

- **Template sidebar:** a slim icon strip that expands on hover to show the Template list and **New ▸ Import / Blank**.
- **Editor window:** a single frosted-glass window. Its header is a breadcrumb (Template / Section / Item / Comment) plus:
  - Save
  - Discard, shown only when there are unsaved changes
  - a saved/unsaved indicator
  - the Trust Report and Versions toggles
- **Columns**, left to right: Sections │ Items │ Comments │ Comment detail. Comments are grouped Informational / Limitations / Deficiencies, each group with its own "+ New". This follows Spectora's columns rather than Hive's tree ([`product-models.md`](../research/product-models.md)).
- **Collapsing:**
  - Columns to the left of the one you're working in collapse into thin vertical strips.
  - Each strip shows the current selection as vertical text, with a light vertical label at the bottom ("Sections" / "Items").
  - Clicking a strip or a breadcrumb segment expands that column again.
  - Picking a Section focuses Items, and picking an Item focuses Comments.
- **Comment detail** shows:
  - the name
  - a Type / Answer / Category / Recommendation row
  - option chips
  - the HTML source and its preview side by side
  - a "Source row N" link to the Source row view
- **Trust Report and Versions** are glass sheets that float over the editor on the right. They're hidden by default, toggled from the header, and both can be open at once. The Source row view replaces the report inside its sheet, with a back link. The sheets sit in a pane host outside the editor, so toggling one never resets unsaved edits. [slice 4 spec][s4]
- **Read-only Version view:** the same editor, with a banner ([Save][t8]).
- **Unsaved changes:** shown in the header.
- **Cut:** mobile and narrow layouts. The app is desktop-only, with a minimum width of about 1200px ([Screens][t5]).

## Visual language

- **Colour:** monochrome neutrals with no accent colour. Light and dark themes follow the system setting. This supersedes "dark mode cut" in [Screens][t5].
- **Type:**
  - 12px base text.
  - 10px uppercase, tracked labels.
  - Answer types shown as small monospace glyphs.
  - Headings in Comment HTML capped at the pane's title size ([Rich content][t10]).
- **Glass:**
  - Surfaces: `backdrop-blur-2xl`, translucent white or near-black fills, hairline borders and a soft shadow.
  - Background: soft grey blurred shapes behind the glass.
  - The prototype's `glass` class is the reference.
- **Comment types** are told apart by weight and fill, never by colour:
  - defect: filled
  - limit: grey
  - info: outline
- **Import issue severity** is also shown by weight, not colour: `warning` is emphasised and `notice` is muted.

## Left to implementation

These are for the implementer to decide, using the prototype as a guide:
- Exact placement, sizes and spacing.
- Iconography.
- The Trust Report's internal layout. The order of its sections is fixed in [taxonomy][t11].
- The Source row view's inline cut highlighting (struck through and labelled with the change kind; see [taxonomy][t11]).

[t5]: https://github.com/vidhatatrivedy/hive-template-importer/issues/5
[t8]: https://github.com/vidhatatrivedy/hive-template-importer/issues/8
[t10]: https://github.com/vidhatatrivedy/hive-template-importer/issues/10
[t11]: https://github.com/vidhatatrivedy/hive-template-importer/issues/11
[t15]: https://github.com/vidhatatrivedy/hive-template-importer/issues/15
[s4]: https://github.com/vidhatatrivedy/hive-template-importer/issues/20
