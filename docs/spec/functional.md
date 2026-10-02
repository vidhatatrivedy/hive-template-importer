# Functional spec

What the app does, for `/to-spec`. Each rule here is a short summary, and the linked ticket or ADR is where the full decision lives. If this file and a ticket disagree, the ticket wins and this file needs fixing. Words in **bold** are defined in [`GLOSSARY.md`](../../GLOSSARY.md). Requirements and grading priorities: [`docs/brief.md`](../brief.md).

Companion specs: [technical](technical.md) (schema, architecture, verification) and [design](design.md) (layout and visual language).

## Scope

- One desk-side web app. It imports a **Spectora export** into a structured, editable, versioned **Template**, and it proves nothing was lost with the **Import Trust Report**.
- Templates are created three ways: **Import**, **Duplicate** (which makes a **Copy**) and **Blank**.
- There's no auth: everyone shares one workspace. It's desktop only, at a minimum width of about 1200px. [Screens][t5]
- Cut: searching across a whole Template, mobile and narrow layouts, duplicating a Section, Item or Comment inside a Template, drag-and-drop (a stretch goal), keyboard navigation between columns (a stretch goal), diff views, merging concurrent edits, and a "download original file" action. [Screens][t5], [Editor][t7], [Save][t8]
- Section and Item settings (icon, Standards of Practice, Reminders, Optional/Included) aren't modelled, so Sections and Items have only a name. The export doesn't carry them, the Trust Report lists them under Missing from export, and adding them would need a schema and editor change. See [`product-models.md`](../research/product-models.md).
- Out of scope for this effort: acknowledging or dismissing Import issues, exporting the Trust Report, and copying **External assets** into storage. See the map's Out of scope section.

## Shell and navigation ([Screens][t5], [Layout][t15])

- `/` opens the most recently saved Template. With no Templates, it shows an empty state with **Import** and **Blank**. [slice 6 spec][s6]
- The Template sidebar is on every page, `/import` and not-found included. It lists Templates newest-saved first; Rename doesn't move a Template. Each row shows the name and a line saying how it was created and when it was last saved, e.g. "Imported · 2h ago", "Copy of X · just now" or "Blank · yesterday" (bands: just now, Nm ago, Nh ago, yesterday, N days ago, then the date). **New ▸ Import / Blank** sits at the top. The open Template's row is marked, also on its read-only Version view. [slice 6 spec][s6]
- Template actions appear in a "⋯" menu on the sidebar row and beside the name in the Template header: [slice 6 spec][s6]
  - **Rename**: a dialog. It saves straight away and never touches unsaved edits.
  - **Duplicate**: opens the Copy. With unsaved edits on the open Template, it warns first that they won't be in the Copy; from a read-only Version view, it says the Copy is made from the latest Version.
  - **Delete**: a hard delete behind a confirm dialog that names the Template and its Version count, plus a line when unsaved edits would be lost. Any Template can be deleted, including the seeded one. Deleting the open Template goes to `/`; deleting another leaves you where you are. A Template already deleted elsewhere counts as done.
- **Blank** asks for a name (trimmed, can't be blank; duplicates allowed), then opens the empty Template in the editor. With unsaved edits it asks to discard only after Create. [slice 6 spec][s6]
- A Template link that no longer exists shows not-found with a link to `/`. [slice 6 spec][s6]
- Column collapsing is an opt-in setting, off by default, in the sidebar settings block. Off, all four columns stay open. On, columns to the left of the one you're working in collapse. It applies to the editor and the read-only Version view, and it never touches unsaved edits.
- The Template header shows counts, the source filename and, for a Copy, the copied-from line.
- The Trust Report and Versions panes are hidden by default, and header toggles open them. Both can be open at once (this supersedes the "one at a time" rule in [Screens][t5]; see [Layout][t15]).
- **Seed** (`npm run seed`, run by the developer) wipes the database and imports InterNACHI Residential as the only Template. There's no in-app reset.

## Import ([Import flow][t6], [Normalisation][t9], [Rich content][t10])

### Flow
1. The user uploads a file. The server parses it without writing anything.
2. The **Import review** shows an editable name, the counts (rows read → Sections / Items / Comments) and Import issue counts by severity.
3. **Import** commits in one transaction, and the new Template opens with its Trust Report pane open. **Cancel** stores nothing.
- The name is prefilled from the filename, dropping the extension and a trailing `-YYYY-MM-DD` (spaces around the dash allowed). It can't be blank after trimming. Duplicate names are allowed.
- Importing the same file again is allowed and creates an independent Template. When the file's SHA-256 matches an existing Import run, the review says *"You imported this file as 'X' on <date>"*.

### Rejected files
A **Rejected file** stores nothing and leaves no **Import run**. Each rejection has its own message ([Import flow][t6]):
1. Not an xlsx zip (a random file, a real legacy `.xls`, CSV or PDF).
2. A **Plain-text export**: no `Comment Text` contains a tag, and at least one bare `&` appears in columns A-D.
3. Larger than 4 MB. This is checked in the browser and again on the server.
4. A required column is missing (`Section Name`, `Item Name`, `Comment Name`, `Comment Text`, `Comment Type`). The message names each one.
5. No data rows.
6. A corrupt or unreadable xlsx.

Everything else imports, with row-level or file-level **Import issues**.

### Faithfulness rules
- **No Source row is ever skipped.** Every non-blank row becomes exactly one Comment, and fully blank rows are counted and ignored.
- Order comes from row position. The `Order` column is kept raw and never used.
- Headers are matched by trimmed name, ignoring case and column order. A missing non-core column, an unknown extra column and an extra sheet each become a warning or notice ([taxonomy][t11]).
- Rows are grouped by contiguous runs of the normalised Section and Item names. A name that reappears later is a **Split run**: it's imported as a separate Section or Item with the same name, flagged, and never merged.
- Duplicates are kept and flagged as a notice.
- Values go through decode entities → trim → interpret. Only the fields the editor shows are normalised, and only those are entity-decoded and counted as "values decoded"; everything else stays raw in the Source row ([slice 2 spec][s2]). [Normalisation][t9] lists the fallbacks:
  - an unknown Comment type → `info`
  - an unknown Answer type → `boolean`
  - a defect without a valid Category → no Category
  - a blank name → "Untitled …"
  - a `t`/`f` boolean default → a real boolean

  Each of these is flagged.
- Comment Text HTML is sanitised by cutting spans out of the source, and every cut is logged. Whitespace is never touched. YouTube iframes are kept, other iframes become links, and images stay hotlinked as External assets. [Rich content][t10], [ADR 0001](../adr/0001-sanitise-comment-html-by-cutting-source-spans.md)

## Import issues and the Trust Report ([taxonomy][t11])

- Every **Import issue** has a severity (`warning` or `notice`) and a class (Changed, **Unsupported**, **Missing from export** or Check). There are 30 kinds: #11's 28, plus `unsafe-style-removed` (a warning, one per removed `url(`, `expression(` or `@import` style value) and `attribute-removed` (a warning, one per attribute that isn't allowlisted and isn't an Editor leftover, such as `onerror` or `id`). Neither is folded into the quiet Editor leftovers notice. Severities live in the [catalogue][t11], as refined by the [slice 2 spec][s2].
- The **Import Trust Report** belongs to an Import run and covers Version 1. From top to bottom it shows:
  1. **Summary**: file, date, short SHA-256, rows read → blank rows → Comments stored, counts, issue counts, values decoded, and the verdict ("392 / 392 rows verified").
  2. **Reconciliation by Section**, expandable to Items, with split runs marked.
  3. **Import issues**, grouped by kind and filterable by severity and class. Each issue links to its Comment in the editor.
  4. **External assets**, grouped by host.
  5. **Kept but not used**: the raw-only columns.
  6. **Missing from export**: always shown.
- "Stored" is recomputed from Version 1 in the database each time the report is shown. Each row gets ✓ or ✗, and ✗ means a bug.
- Once the Template is past Version 1, the report adds: "Describes Version 1, as imported. This Template is now at Version N."
- **Source row view**: every imported Comment has a "Source row N" view. It shows raw → stored for the edited fields, the raw HTML with each logged cut highlighted inline, the rendered stored HTML and every raw cell of the row. "Stored" is the report's Version 1, not the latest Version. It's reached at `?pane=trust&row=<n>`, and every row-level issue links to it. A Comment added in the editor shows "Added in the editor, no Source row." [slice 4 spec][s4]
- Blank Templates have no report and no toggle. A Copy (including a Copy of a Copy) shows the import's report, read-only and labelled. It reconciles against the Version 1 of the Template that was imported, not against the Copy's source. Once that imported Template is deleted, the Copy still shows the report, labelled "Not re-verified", with no verdict and no ✓/✗. Locations then come from the Copy's own Version 1, because the evidence survives but no stored "as imported" tree does. This supersedes "a Copy shows its source's report" and the "report was deleted" message in [taxonomy][t11]. See [Schema][t12] and the [slice 4 spec][s4].

## Editor ([Editor][t7])

- The columns are Sections │ Items │ Comments │ Comment detail.
- Comments in an Item are shown grouped Informational / Limitations / Deficiencies, each group in file order, each with its own "+ New". The stored order is always file order.
- Sections, Items and Comments can be added, deleted, and moved with ↑/↓ within their parent. Comments move within their type group: a move swaps the Comment with the nearest Comment of the same type in stored order, and every other Comment keeps its position. Changing a Comment's type moves it to the end of its Item's stored list, so it shows last in its new group. [slice 5 spec][s5]
  - Deletes cascade with no confirm, because Discard is the undo. The exception is a non-empty Section, which asks first and names what's inside ("Delete *Roof* and its 4 Items, 37 Comments?").
  - New nodes go at the end of their column or group, with the name field focused. A new Comment is `boolean` with every other field blank. A new defect has no Category.
- Comment fields:
  - **Editable:** Name, Text, Comment type, Category (defects only), Recommendation (a dropdown of slugs used in this Template, plus free text), Answer type, Multiple-choice options (checkbox only, edited as a list), Default value (depends on the Answer type).
  - **Read-only:** Unit options, Default location, Estimate min/max, Default photos, Last modified. Apart from Unit options these aren't in the tree, so the editor reads them from the Source row. [slice 5 spec][s5]
  - **Hidden:** everything else, visible only in the Source row view.
- A value made irrelevant by another change (a Category after defect → info, options after checkbox → text) is kept and hidden, never cleared.
- Comment text is shown rendered. **Edit** opens the HTML source with a live preview; there's no WYSIWYG editor. The preview runs the import sanitiser, and before Save a notice lists what will be removed. Comments nobody edited stay byte-identical.
- Validation: only an empty name blocks Save; each blank name is marked and the editor jumps to the first. Duplicate sibling names and empty Sections or Items are allowed. A checkbox with no options gets a soft warning. On Save, names, Recommendation, option entries and free-text defaults are trimmed, a blank Recommendation or default becomes empty, and empty option entries are dropped. On imported data this changes nothing. [slice 5 spec][s5]
- `?row=<n>` selects the Comment carrying that Source row and scrolls to it. If none does (for example, it was deleted), the detail says so. [slice 5 spec][s5]
- An edited imported Comment keeps its **Source row**.

## Save and Versions ([Save][t8])

- One **Save** commits every pending change in one transaction and makes exactly one **Version**. Save is disabled when nothing has changed.
- Unsaved edits live only in client memory. The header shows "Unsaved changes" with Save and Discard. Switching Template, New, Duplicate, opening an old Version and Discard all ask "Discard unsaved changes?" first ([slice 6 spec][s6] words the Duplicate and Delete prompts), and closing the tab triggers `beforeunload`. Restore is only reachable from the read-only view, which has no edits. Toggling a pane or following a Source row link never loses edits. The browser's back and forward buttons aren't guarded (NOTES.md). [slice 5 spec][s5]
- Before Save, a notice lists what the sanitiser will remove from each edited Comment, with Save anyway / Keep editing. A Save that fails for any reason keeps the edits on screen. A newer Version that arrives while there are unsaved edits never replaces them. [slice 5 spec][s5]
- Every Template has a Version 1:
  - Import: as imported.
  - Blank: empty.
  - Duplicate: the source's latest *saved* Version.
- Each Version records its number, time, counts and origin label: "Imported from *file*", "Created blank", "Copied from *Name* v3", "Saved" or "Restored from v2".
- Rename saves immediately and makes no Version. It doesn't change the last-saved sort.
- An old Version opens read-only in the same editor at `/t/[id]/v/[n]`, with the banner "Viewing Version 3 · <origin label> · <date> · Restore this version · Back to current". It keeps the Trust Report toggle and `?row=`. The latest Version's number redirects to the editor. Restore is on the banner only, not in the Versions sheet, and creates Version N+1 with the old Version's full content, Source row links included. [slice 5 spec][s5]
- Concurrent Saves: Save carries its base Version number. If that's stale, the Save is refused with **Load latest**. Nothing is ever silently overwritten.

## Duplicate and Delete ([Screens][t5], [Save][t8], [Schema][t12])

- Duplicate makes an independent Template whose Version 1 is the source's latest Version. It records the source's name and Version number, and each Comment keeps its Source row. Editing either Template never changes the other.
- Deleting a source Template leaves its Copies intact. A Copy shows "copied from *Name* vN (deleted)".

## Evidence for reviewers ([Verification][t14])

- `npm run verify` prints a per-fixture table in which unexplained differences must be 0. NOTES.md includes its output.
- The video's failure case is the plain-text export being rejected. The refused concurrent Save gets one line.

## Not yet specified

- The walkthrough-video script and the content of NOTES.md. These come after the spec; see the map's Not yet specified section.

[t5]: https://github.com/vidhatatrivedy/hive-template-importer/issues/5
[t6]: https://github.com/vidhatatrivedy/hive-template-importer/issues/6
[t7]: https://github.com/vidhatatrivedy/hive-template-importer/issues/7
[t8]: https://github.com/vidhatatrivedy/hive-template-importer/issues/8
[t9]: https://github.com/vidhatatrivedy/hive-template-importer/issues/9
[t10]: https://github.com/vidhatatrivedy/hive-template-importer/issues/10
[t11]: https://github.com/vidhatatrivedy/hive-template-importer/issues/11
[t12]: https://github.com/vidhatatrivedy/hive-template-importer/issues/12
[t14]: https://github.com/vidhatatrivedy/hive-template-importer/issues/14
[t15]: https://github.com/vidhatatrivedy/hive-template-importer/issues/15
[s2]: https://github.com/vidhatatrivedy/hive-template-importer/issues/18
[s4]: https://github.com/vidhatatrivedy/hive-template-importer/issues/20
[s5]: https://github.com/vidhatatrivedy/hive-template-importer/issues/21
[s6]: https://github.com/vidhatatrivedy/hive-template-importer/issues/22
