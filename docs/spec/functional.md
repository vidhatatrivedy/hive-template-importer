# Functional spec

What the app does, for `/to-spec`. Each rule here is a short summary, and the linked ticket or ADR is where the full decision lives. If this file and a ticket disagree, the ticket wins and this file needs fixing. Words in **bold** are defined in [`GLOSSARY.md`](../../GLOSSARY.md). Requirements and grading priorities: [`docs/brief.md`](../brief.md).

Companion specs: [technical](technical.md) (schema, architecture, verification) and [design](design.md) (layout and visual language).

## Scope

- One desk-side web app. It imports a **Spectora export** into a structured, editable, versioned **Template**, and it proves nothing was lost with the **Import Trust Report**.
- Templates are created three ways: **Import**, **Duplicate** (which makes a **Copy**) and **Blank**.
- There's no auth: everyone shares one workspace. It's desktop only, at a minimum width of about 1200px. [Screens][t5]
- Cut: searching across a whole Template, mobile and narrow layouts, duplicating a Section, Item or Comment inside a Template, drag-and-drop (a stretch goal), keyboard navigation between columns (a stretch goal), diff views, merging concurrent edits, and a "download original file" action. [Screens][t5], [Editor][t7], [Save][t8]
- Out of scope for this effort: acknowledging or dismissing Import issues, exporting the Trust Report, and copying **External assets** into storage. See the map's Out of scope section.

## Shell and navigation ([Screens][t5], [Layout][t15])

- `/` opens the most recently saved Template. With no Templates, it shows an empty state that points to **New ▸ Import / Blank**.
- The Template sidebar lists Templates newest-saved first. Each row shows the name and a line saying how it was created and when it was last saved, e.g. "Imported · 2h ago", "Copy of X · just now" or "Blank · yesterday". **New ▸ Import / Blank** sits at the top.
- Template actions appear on the sidebar row and in the Template header:
  - **Rename**
  - **Duplicate**
  - **Delete**: a hard delete behind a confirm dialog that names the Template. Any Template can be deleted, including the seeded one.
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

- Every **Import issue** has a severity (`warning` or `notice`) and a class (Changed, **Unsupported**, **Missing from export** or Check). The 29 kinds and their severities are in the [catalogue][t11]: #11's 28 plus `unsafe-style-removed` (a warning, one per removed `url(`, `expression(` or `@import` style value), added by the [slice 2 spec][s2].
- The **Import Trust Report** belongs to an Import run and covers Version 1. From top to bottom it shows:
  1. **Summary**: file, date, short SHA-256, rows read → blank rows → Comments stored, counts, issue counts, values decoded, and the verdict ("392 / 392 rows verified").
  2. **Reconciliation by Section**, expandable to Items, with split runs marked.
  3. **Import issues**, grouped by kind and filterable by severity and class. Each issue links to its Comment in the editor.
  4. **External assets**, grouped by host.
  5. **Kept but not used**: the raw-only columns.
  6. **Missing from export**: always shown.
- "Stored" is recomputed from Version 1 in the database each time the report is shown. Each row gets ✓ or ✗, and ✗ means a bug.
- Once the Template is past Version 1, the report adds: "Describes Version 1, as imported. This Template is now at Version N."
- **Source row view**: every imported Comment has a "Source row N" view. It shows raw → stored for the edited fields, the raw HTML with each logged cut highlighted inline, and the rendered stored HTML. A Comment added in the editor shows "Added in the editor, no Source row."
- Blank Templates have no report. A Copy shows its source's report, read-only and labelled, and still shows it after the source is deleted, because the Import run survives while it's referenced. This supersedes the "report was deleted" message in [taxonomy][t11]; see [Schema][t12].

## Editor ([Editor][t7])

- The columns are Sections │ Items │ Comments │ Comment detail.
- Comments in an Item are shown grouped Informational / Limitations / Deficiencies, each group in file order, each with its own "+ New". The stored order is always file order.
- Sections, Items and Comments can be added, deleted, and moved with ↑/↓ within their parent. Comments move within their type group.
  - Deletes cascade with no confirm, because Discard is the undo. The exception is a non-empty Section, which asks first and names what's inside ("Delete *Roof* and its 4 Items, 37 Comments?").
  - New nodes go at the end of their column or group, with the name field focused. A new Comment is `boolean` with every other field blank. A new defect has no Category.
- Comment fields:
  - **Editable:** Name, Text, Comment type, Category (defects only), Recommendation (a dropdown of slugs used in this Template, plus free text), Answer type, Multiple-choice options (checkbox only, edited as a list), Default value (depends on the Answer type).
  - **Read-only:** Unit options, Default location, Estimate min/max, Default photos, Last modified.
  - **Hidden:** everything else, visible only in the Source row view.
- A value made irrelevant by another change (a Category after defect → info, options after checkbox → text) is kept and hidden, never cleared.
- Comment text is shown rendered. **Edit** opens the HTML source with a live preview; there's no WYSIWYG editor. The preview runs the import sanitiser, and before Save a notice lists what will be removed. Comments nobody edited stay byte-identical.
- Validation: only an empty name blocks Save. Duplicate sibling names and empty Sections or Items are allowed. A checkbox with no options gets a soft warning. Names are trimmed on Save.
- An edited imported Comment keeps its **Source row**.

## Save and Versions ([Save][t8])

- One **Save** commits every pending change in one transaction and makes exactly one **Version**. Save is disabled when nothing has changed.
- Unsaved edits live only in client memory. The header shows "Unsaved changes" with Save and Discard. Switching Template, New, opening an old Version and Restore all confirm first, and closing the tab triggers `beforeunload`.
- Every Template has a Version 1:
  - Import: as imported.
  - Blank: empty.
  - Duplicate: the source's latest *saved* Version.
- Each Version records its number, time, counts and origin label: "Imported from *file*", "Created blank", "Copied from *Name* v3", "Saved" or "Restored from v2".
- Rename saves immediately and makes no Version. It doesn't change the last-saved sort.
- An old Version opens read-only in the same editor, with the banner "Viewing Version 3 · … · Restore this version · Back to current". Restore creates Version N+1 with the old Version's full content, Source row links included.
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
