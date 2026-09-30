# Glossary

Domain vocabulary for this repo. Use these terms in code, issues, tests and UI. Refined by `/domain-modeling`.

- **Template**: an inspector's reusable report structure and comment library. Ordered list of Sections. Created by **Import**, **Duplicate** or **Blank** creation.
- **Import**: creating a Template from a Spectora export.
- **Duplicate**: creating an independent **Copy** of an existing Template. The Copy starts its own Version history at Version 1 and records the Template and Version it came from. _Avoid_: clone.
- **Copy**: a Template made by Duplicate. Editing it never changes the original.
- **Blank**: creating an empty, named Template to build by hand in the editor. _Avoid_: custom template, wizard.
- **Version**: a numbered, read-only snapshot of a Template's content, taken on each explicit Save. Every Template has a Version 1 from its creation (as imported, empty for Blank, or the source's latest Version for a Copy), and its latest Version is its saved state. Restoring an old Version creates a new Version. The Template's name is not part of a Version. _Avoid_: revision, draft.
- **Save**: committing all unsaved changes to a Template at once, making exactly one new Version. Refused if another Save made a newer Version meanwhile. _Avoid_: autosave, publish.
- **Section**: top-level grouping in a Template (e.g. *Roof*). Hive calls this a Section too.
- **Item**: a grouping inside a Section (e.g. *Roof › Coverings*). Spectora's term; Hive calls it a **Subsection**. We use *Item*.
- **Comment**: one row of a Spectora export; a reusable entry inside an Item. Has a **Comment type** and an **Answer type**. Hive calls these **Fields**.
- **Comment type**: `info` (Informational), `limit` (Limitation) or `defect` (Deficiency).
- **Answer type**: how a Comment is answered during an inspection: `boolean`, `checkbox` (multiple choice), `number`, `range`, `text`, `date`.
- **Category**: severity of a defect, `-1` / `0` / `1` = Low / Medium / High (Hive: Maintenance / Recommendation / Safety).
- **Recommendation**: the contractor type a defect is referred to, as a Spectora slug (`pro`, `electrician`, `roof`, ...).
- **Spectora export**: the spreadsheet from *Export to spreadsheet → Export HTML Text*. 42 fixed columns, one row per Comment, no IDs. Named `.xls` but actually `.xlsx`.
- **Plain-text export**: Spectora's other spreadsheet export, with the same columns as the Spectora export but HTML stripped (link URLs lost) and entities decoded. The importer rejects it. _Avoid_: text export.
- **Source row**: one data row of a Spectora export, identified by its 1-based sheet row number. Every imported Comment keeps its Source row, through edits and copies. A Comment added in the editor has none.
- **Import run**: one committed import of one Spectora export, producing one Template plus its **Import issues**. Rejected files and cancelled Import reviews leave no Import run.
- **Import review**: the step between parsing an upload and committing it, showing the Template name, counts and Import issue counts. Nothing is stored yet. _Avoid_: preview, dry run.
- **Rejected file**: an upload that fails a file-level check. Nothing is stored and no Import run exists.
- **Split run**: a Section or Item name that reappears in an export after rows of a different Section or Item. Each run is imported as its own Section or Item, in file order, and flagged. _Avoid_: merged item.
- **Import issue**: something the importer skipped, changed or wants the user to check, with a severity and the Source row it came from.
- **Missing from export**: information Spectora does not put in the file (empty sections, section settings, attachments). Contrast with **Unsupported**: information in the file that our importer does not handle.
- **Import Trust Report**: the post-import view that reconciles Source rows with stored Comments and lists every Import issue.
- **Seed**: returning the app to its demo state: every Template and its history is cleared, then InterNACHI Residential is imported as the only Template. _Avoid_: reset demo, fixture load.
