# Spectora "HTML Text" export: format reference

Profiled on 2026-09-30 against all six files in `fixtures/spectora/` (scripted inspection of every cell). Per-file provenance and headline quirks are in `fixtures/spectora/README.md`; this is the detailed reference.

## Container

- Produced by *Template → ⋮ → Export to spreadsheet → Export HTML Text*.
- The file is an **Office Open XML workbook** (zip: `xl/workbook.xml`, `xl/worksheets/sheet1.xml`, …) with a **`.xls` extension**. Libraries that route on extension (e.g. openpyxl) refuse it; read it from bytes or sniff the zip signature (`PK\x03\x04`).
- One sheet (`Sheet1`). Row 1 is the header. Every data row is one **Comment**.
- Largest cell seen: 2,435 chars (well below Excel's 32,767 limit).

## Columns (identical 42-column header in all six files)

| # | Header (verbatim) | Observed values / notes |
|---|---|---|
| 0 | `Section Name` | Always present. HTML-entity encoded (`&amp;`). Some have leading/trailing spaces. |
| 1 | `Item Name` | Always present. Same encoding/whitespace quirks. Same item name recurs across sections (Room-by-Room). |
| 2 | `Comment Name` | Always present. Entity-encoded (35 names with `&amp;` in Ben). |
| 3 | `Comment Text` | HTML or plain text, or **empty** (see below). |
| 4 | `Comment Type (info, limit, defect)` | Exactly `info` / `limit` / `defect`. |
| 5 | `Category (-1: Low, 0: Med, 1: High)` | Set only on `defect` rows: `-1`, `0`, `1`. |
| 6 | `Multiple Choice Options (comma-separated)` | Options for `checkbox` answers, e.g. `Occupied, Vacant, Furnished, Utilities Off`. |
| 7 | `Unit Type Options (numeric answers only, comma-separated)` | e.g. `Fahrenheit (F), Celsius (C)`, `SEER`, `gallons`, `hr`, `days`, `pCi/l`. Once on a `range` answer: `0-5 years, 5-15 years, 15+ years, Varies, Undetermined`. |
| 8 | `Recommendation (from list)` | Contractor slug: `pro` (most common), `electrician`, `plumber`, `roof`, `gc`, `diy`, `hvac`, `handyman`, `monitor`, `structural`, … (37 distinct in Ben). Often blank in InterNACHI Residential. |
| 9 | `Order (w/i item)` | Integer, **sometimes stored as a string** (`'5'` in Radon, int in Residential). Mostly ties (634/798 rows are `5` in Room-by-Room). Never decreases within an item. **Not a reliable order; row position is.** |
| 10 | `Answer Type (boolean, checkbox, date, number, range, text)` | Seen: `boolean`, `checkbox`, `number`, `range`, `text`. `date` never seen. |
| 11 | `Default Value` | Mostly blank. Seen: `true`, `false`, **`f`** (12 rows in Ben, equivalent to false), a checkbox option (`Client`). |
| 12 | `Default Value 2 (for "range" types)` | Never populated in fixtures. |
| 13 | `Default Unit Type (for "number" and "range" types)` | Never populated in fixtures. |
| 14 | `Default Location` | Rare: `' Kitchen'`, `' Attic'` (**leading space**), `Laundry`, `defloc` (hand-added). |
| 15 | `Default Estimate Min` | Always `10` in every fixture: Spectora's stock default. |
| 16 | `Default Estimate Max` | Always `1000`: stock default. |
| 17 | `Locked` | Never populated. |
| 18 | `Simple Format` | Never populated. |
| 19 | `Disable Photos` | Never populated. |
| 20 | `Uses` | Always `0`: usage counter, meaningless for a fresh account. |
| 21-40 | `Default Photo 1..10`, `Default Photo 1..10 Caption` | Only in Ben: 18 rows with photo 1, 7 with captions. URLs on `cdn.spectora.com/default_photos/...`. |
| 41 | `Last Modified` | `MM/DD/YYYY HH:MM:SS` timestamp per row. |

## Hierarchy and order

- There are no IDs. Hierarchy comes from repeating `Section Name` / `Item Name` on every row.
- In every fixture, rows of a section are **contiguous**, and rows of an item are contiguous. Sections are not alphabetical, and items are alphabetical in only 1 section per file. So **row order is the template's order.**
- Within an item, rows are **not** grouped by comment type (only 41 of 133 items in Ben are info → limit → defect). Spectora's editor *displays* comments grouped by type (Informational / Limitations / Recommendations-Deficiencies); the file order is a storage order.
- Grouping by name alone would merge two different items that share a name within one section. Grouping by contiguous run avoids that, but a split run of the same name can't be told apart from a genuinely repeated item. No fixture has a split run.

## Empty text is normal

Rows with empty `Comment Text` (InterNACHI Residential): 71 `info/checkbox`, 3 `info/number`, 6 `defect/boolean`, 3 `limit/boolean`. Most are **fields** (e.g. "Occupancy" with checkbox options), not broken comments.

## Duplicates

The same (section, item, comment name, type) appears more than once:

- Ben: 5 cases. Examples: "Missing GFCI in Unfinished Basement" (rows 306/308, byte-identical), "Major Cracking at Driveway" (same text, other columns differ), "Defect at Glass Doors at Fireplace" (different text).
- InterNACHI Residential and Residential: "Damper Inoperable" (different text).

All are real content. Never dedupe.

## Rich content in `Comment Text`

Written by Spectora's Froala editor.

| | Ben | InterNACHI Res. | Room-by-Room | Commercial |
|---|---|---|---|---|
| Tags | `p` 1700, `li` 89, `br` 79, `a` 42, `ol` 15, `img` 13, `strong` 9, `ul` 7, `span` 7, `div` 7, `iframe` 2, `h3` 1 | `p` 244, `a` 43, `strong` 1, `div` 1 | `p` 445, `a` 81, `div` 7 | `p` 249, `a` 34, `div` 1 |
| Plain-text (no tags) | 3 | 111 | 293 | 106 |

- Editor noise attributes: `style` (inline colours and sizes), `fr-original-style`, `draggable`, `rel`, `target`, `data-testid`, `data-mesh-id`, `contenteditable`, `class="fr-video fr-draggable"`, `class="fr-draggable"`.
- **Images:** `<img src="https://cdn.spectora.com/editor_assets/images/...">`, sometimes wrapped in `<a href>`, sometimes with `width`/`height` (`width="131"` on the "Annual" logo).
- **Video:** two `<span class="fr-video"><iframe src="https://www.youtube.com/embed/...">` in Ben › Inspection Detail › Buy Back Guarantee › "We'll Buy Your Home Back".
- **Heading:** one `<h3>` in Ben › Inspection Detail › While I'm Here... › "Other Inspection Services".
- Entities: `&amp;`; non-breaking spaces (`\xa0`); trailing `\r\n` inside HTML. Empty spacer paragraphs `<p><br></p>` are part of the author's layout.
- Plain-text comments contain no URLs and no newlines, but do contain entities (`Flashing &amp; trim`).
- External asset hosts: `cdn.spectora.com` (editor images and default photos) and `www.youtube.com`. These may stop resolving once the customer leaves Spectora.

## Missing from the export (Spectora never writes it)

Confirmed by building a template in Spectora's UI and exporting it (Radon fixture):

- **Empty sections and items.** Any section or item with zero comments has no row, so it is absent. Radon was built with sections `devone` (no items) and `devtwo` (empty "General" plus an empty custom item); neither appears.
- Template name (only the filename carries it, with the export date appended).
- Template attachments (PDFs etc.).
- Section settings: icon, *Standards of Practice* (rich text), *Reminders*, *Hide Overview Grid*, *Optional/Included*.
- Item settings: *Info Item (no ratings/defects/grid row)* flag, *Optional/Included*, *Reminders*.
- Human-readable labels for recommendation slugs.
- Default photos as files (URLs only).

## Diff between two exports: what a user edit looks like

`Residential Template` = `InterNACHI Residential` + a hand-added item `Dev` in *Inspection Details* (3 rows, placed first in the section):

| Comment Name | Type | Answer | Order | Extras |
|---|---|---|---|---|
| `lim one text` | limit | text | 0 | |
| `info one checkboc` | info | boolean | 0 | |
| `info two text` | info | checkbox | 1 | options `concrete, wood, metal`, location `defloc` |

Useful for demoing order preservation. The new item sits *before* the stock "General" item.
