# Spectora export fixtures

Real exports produced by Spectora's **Template → ⋮ → Export to spreadsheet → Export HTML Text**, downloaded on 2026-09-30 from a free Spectora trial account. They contain Spectora's stock sample templates only, with no customer data.

The files are Office Open XML workbooks (`.xlsx` zip containers) even though Spectora names them `.xls`. The importer must sniff the content, not trust the extension.

| File | Source template | Rows | Sections | Items | Why it's here |
|---|---|---|---|---|---|
| `InterNACHI Residential -2026-09-30.xls` | Spectora Template Center: InterNACHI Residential | 392 | 13 | 69 | **Primary fixture** (named in the brief); seeded into the live app |
| `Residential Template-2026-09-30.xls` | Copy of InterNACHI Residential, hand-edited | 395 | 13 | 70 | Adds an item `Dev` with 3 comments at the top of *Inspection Details* (tests order preservation) |
| `InterNACHI Commercial Template-2026-09-30.xls` | Spectora Template Center | 406 | 15 | 67 | Second real template |
| `Room-by-Room Residential Template-2026-09-30.xls` | Spectora Template Center | 798 | 22 | 136 | Repeated structure (Bedroom 2-6, Bathroom 1-4) |
| `Ben Gromicko's Template for Home Inspections-2026-09-30.xls` | Spectora Template Center | 1248 | 17 | 133 | Stress test: inline images, YouTube iframes, `h3`, lists, duplicate comments, default photos |
| `Radon Inspection-2026-09-30.xls` | Spectora Template Center, hand-edited | 10 | 2 | 3 | Built with 4 sections in Spectora; two empty sections (`devone`, `devtwo`) are **absent from the export** |
| `InterNACHI Residential -2026-09-30 (plain text).xls` | InterNACHI Residential via **Export Plain Text** (not HTML Text) | 392 | 13 | 69 | **Must be rejected.** Same 42 columns and rows as the HTML export, but tags stripped (link URLs lost) and entities decoded. Tests plain-text detection |

## Known quirks (verified by profiling)

- One row per comment. There are no IDs. Hierarchy is carried by repeated `Section Name` / `Item Name` values.
- Row order is the template order. `Order (w/i item)` is mostly ties (e.g. 634 of 798 rows are `5`) and is sometimes an int, sometimes a string.
- Names are HTML-entity encoded (`Attic, Insulation &amp; Ventilation`).
- Duplicate comments exist within one item, sometimes byte-identical (Ben rows 306 and 308).
- Empty sections and items (no comments) are not exported at all.
- Section/item settings (icon, standards of practice, reminders, optional/included), template attachments and the template name are not exported.
