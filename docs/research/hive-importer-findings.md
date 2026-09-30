# Hive's Spectora importer: observed behaviour

Tested 2026-09-30 in a Hive trial org ("Hive FDE Assignment") by uploading the fixtures in `fixtures/spectora/`, then comparing Hive's result with the source rows. Screenshots were taken during the session; findings were checked against the export data.

## What Hive preserves

| Check | Source | Hive |
|---|---|---|
| InterNACHI Residential counts | 13 sections / 69 items / 392 rows | 13 / 69 / 392 |
| Radon counts | 2 / 3 / 10 | 2 / 3 / 10 |
| `&amp;` in names | encoded | decoded correctly |
| Section, item and comment order | row order | matches |
| Duplicate "Missing GFCI in Unfinished Basement" (Ben, Basement) | 2 rows | 2 comments |
| Defect category `-1/0/1` | Low/Med/High | Maintenance Items / Recommendations / Safety Concerns |
| Recommendation `pro` | slug | service "Qualified Professional" |
| Boolean with Default Value `true` | `boolean`, `true` | Checkbox Item, "Auto-select" on |
| Inline images, bold, bullet lists, links | HTML | rendered (images still hotlinked to `cdn.spectora.com`) |

## What Hive loses or obscures (all silently)

1. **No import summary or warnings.** The only check available is the Overview counters, which are never compared with the source file.
2. **Number fields become text fields, and units are dropped.** Radon "Measurement Interval" is `number` with unit `hr`; Hive's edit dialog shows "Text: a text input field". The same applies to "Elapse Time" (`days`).
3. **YouTube iframes are dropped.** "We'll Buy Your Home Back" contains two `<iframe src="https://www.youtube.com/embed/...">` embeds between the bullet list and the closing link. Hive shows empty space. (Not yet verified whether the iframes survive in the stored HTML but are unrendered: check with the `</>` code view.)
4. **Headings are flattened.** In "Other Inspection Services", `<h3>ANNUAL HOME MAINTENANCE INSPECTION: $75</h3>` renders as body text. The image's `width="131"` is ignored, so it renders large.
5. **Empty sections vanish without notice.** This is caused by Spectora's export (see `fixtures/spectora/README.md`), but Hive could warn about it.
6. **The template name is taken from the filename,** including the export date: `InterNACHI Residential -2026-09-30`.
7. **An "You have unsaved changes" banner appears right after import,** before any edit, so it is unclear whether the import is persisted.
8. **Poor bad-file error.** Uploading an unrelated `.xlsx` shows `Import Failed 'Section Name'`, a raw missing-key message.

## Thoughtful touches worth noting

- The import dialog has an opt-in **"Import cost estimates"** checkbox, noting that stock Spectora templates put the same default range (10-1000) on every comment.
- Support offers a free, done-for-you import via chat. That signals the self-serve path isn't trusted to be the whole answer.

## Implications for this project

Hive already matches row counts, so our advantage is **proof and transparency**, not raw fidelity:

- Preserve answer types, options and units exactly.
- Keep headings, image sizes and YouTube embeds, or turn embeds into links, and report what the sanitiser changed per comment.
- Ship an Import Trust Report: per-section reconciliation, an empty-sections notice, externally hosted assets, duplicates, default-looking estimate ranges.
- Name the template at upload, prefilled from the filename with the date suffix stripped.
- Save the import atomically, with an unambiguous saved state.
- Give specific, actionable errors for wrong files.
