# xlsx readers for the Spectora export (server-side, from bytes)

Tested 2026-09-30 for issue #2. Each library read all six files in `fixtures/spectora/` from an in-memory `Buffer` (the filename is never passed, so the `.xls` extension is irrelevant). Every cell was compared with a reference grid. Five of them (all except node-xlsx) were then bundled into a Next.js 16.3.7 (Turbopack) route handler with `runtime = 'nodejs'`, built with `next build`, run with `next start`, and sent each fixture as `multipart/form-data`. The results matched the plain-Node results exactly. Facts only. The pick is made in a later ticket.

## How the export stores cells (this is what trips libraries up)

Raw `xl/worksheets/sheet1.xml`, all six files:

- **No `sharedStrings.xml`, no formulas.** Every string is `<c t="str"><v xml:space="preserve">…</v></c>`. `t="str"` normally means "cached formula result". Spectora uses it for plain values.
- Numbers are `<c><v>5</v></c>` (no `t`). Absent values are either a missing `<c>` or an empty `<c s="0"/>`.
- Empty strings are a third form, `<c t="str"><v/></c>`: 9 to 188 per file, in `Comment Text` (426 in all), `Default Value` (203), `Default Location` (32), `Default Value 2` (1).
- Names are HTML-entity encoded, so the XML holds `&amp;amp;` and the true cell value is `&amp;`. `&amp;` is the only entity in any cell value (1,784 occurrences: `Item Name`, `Section Name`, `Comment Name`, `Comment Text`).
- `\r\n` inside 243 `Comment Text` cells. Trailing whitespace in 1,160 cells (`Comment Text`, `Comment Name`, `Item Name`). Leading whitespace in 9 cells (Ben).
- Row numbers are contiguous from 1 with no gaps. `<dimension>` is `A1:AP{n}`.

**Reference grid.** A 60-line reader (fflate unzip, regex over `<row>`/`<c>`, a single XML-entity decode) was cross-checked against Python **openpyxl 3.0.10** loaded from `BytesIO`. There were 0 differences on every cell of all six files. The fidelity tables below diff each library against this grid.

> Discrepancy with `spectora-export-format.md`: that doc says `Order (w/i item)` is "sometimes stored as a string ('5' in Radon)". In the raw XML, every `Order` cell in all six fixtures is numeric (`<c><v>5</v></c>`), and both the reference reader and openpyxl return a number.

## Libraries at a glance

| | SheetJS CE `xlsx` 0.20.3 (CDN) | SheetJS `xlsx` 0.18.5 (npm) | exceljs 4.4.0 | read-excel-file 9.3.10 | xlsx-populate 1.21.0 | node-xlsx 0.24.0 |
|---|---|---|---|---|---|---|
| License | Apache-2.0 | Apache-2.0 | MIT | MIT | MIT | Apache-2.0 |
| Latest release | 0.20.3, tagged 2024-07-18; last commit 2026-02-09 | 2022-03-24 (last on npm) | 2023-10-19 (4.4.1-prerelease.0 on 2024-12-20); last commit on default branch 2024-01-12 | 2026-08-10 | 2020-03-01; last push 2024-03-12 | 2024-04-15 |
| Installed `node_modules` (alone) | 7.8 MB, 1 pkg | ~7.5 MB unpacked | 34.0 MB, 97 pkgs | 5.3 MB, 7 pkgs | 22.0 MB, 19 pkgs | 7.8 MB, 2 pkgs (wraps SheetJS 0.20.2) |
| Types | bundled | bundled | bundled | bundled | none (no `@types/xlsx-populate` on npm) | bundled |
| Buffer input | `read(buf, {type:'buffer'})`, or `{type:'array'}` for Uint8Array | same | `workbook.xlsx.load(buf)` | `readSheet(buf)` from `read-excel-file/node`; `/universal` takes ArrayBuffer/Blob | `fromDataAsync(buf)` | `parse(buf)` |
| `npm audit` | clean | **2 high**: prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9 | 1 moderate via `uuid@8` (GHSA-w5hq-g745-h8pq) | clean | clean | clean |

Sources: npm registry metadata (`npm view <pkg> --json`, 2026-09-30); GitHub repo API (`archived`, `pushed_at`, license); git.sheetjs.com tag and commit API; `npm audit` in the scratch project; `du -sk` of a clean single-package install.

- **SheetJS distribution.** The docs say the SheetJS CDN is "the authoritative source" and that npm's `xlsx` is stuck at 0.18.5. Install from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, and vendoring the tarball is "strongly recommended" ([SheetJS Node.js install docs](https://docs.sheetjs.com/docs/getting-started/installation/nodejs)). No 0.20.4 or 0.21.x tarball exists on the CDN (HTTP 404, probed 2026-09-30). The GitHub mirror says "New home https://git.sheetjs.com/SheetJS/sheetjs". `@e965/xlsx` 0.20.3 is a third-party npm republish of the same code.
- **xlsx-populate** has 156 open issues, and **exceljs** has 809 (GitHub API). Neither repo is archived.

## Fidelity against the six fixtures

Row counts, header row (42 columns, verbatim) and row positions (row *n* in the file equals row *n* in the output) were correct for **every library on every fixture**: 11 / 393 / 396 / 407 / 799 / 1,249 rows including the header. No numbers became strings, and no strings became numbers or `Date`s (`Last Modified` stays a `MM/DD/YYYY HH:MM:SS` string everywhere). The differences are all in string content and empty strings.

Cells that differ from the reference, per fixture (Radon / Residential / InterNACHI Res. / Commercial / Room-by-Room / Ben):

| Library | Changed string content | `""` returned as `null` | What changed |
|---|---|---|---|
| SheetJS 0.20.3 (CDN) | 0 / 321 / 321 / 298 / 438 / 577 | 0 | `&amp;` → `&` (second XML decode) and `\r\n` → `\n` |
| node-xlsx 0.24.0 | same as SheetJS 0.20.3 | 0 | same (bundles SheetJS 0.20.2) |
| exceljs 4.4.0 | 0 / 282 / 282 / 227 / 369 / 568 | 9 / 139 / 136 / 104 / 188 / 86 | `&amp;` → `&` (second decode); `\r\n` kept |
| read-excel-file 9.3.10 (default) | 1 / 221 / 221 / 246 / 418 / 62 | same as exceljs | **trims** leading and trailing whitespace (default `trim: true`) |
| read-excel-file 9.3.10 `{trim:false}` | 0 | same as exceljs | none |
| xlsx-populate 1.21.0 | 0 | same as exceljs | none (but see numeric coercion below) |
| SheetJS 0.18.5 (npm) | 0 | 0 | none |

Examples: `Gutters &amp; Downspouts` → `Gutters & Downspouts` (SheetJS 0.20.3, exceljs). `Joist Hanger Defect ` → `Joist Hanger Defect` (read-excel-file default).

### Synthetic edge cases (not in the fixtures)

To check behaviour the fixtures don't exercise, the Radon file was modified so that `t="str"` cells hold the true values below. openpyxl returns every one unchanged.

| True value | SheetJS 0.20.3 | exceljs | xlsx-populate | read-excel-file `{trim:false}`, SheetJS 0.18.5 |
|---|---|---|---|---|
| `&lt;b&gt;not a tag&lt;/b&gt;` | `<b>not a tag</b>` | `<b>not a tag</b>` | exact | exact |
| `Tom &amp;amp; Jerry` | `Tom &amp; Jerry` | `Tom &amp; Jerry` | exact | exact |
| `&#39;quoted&#39;` | `'quoted'` | exact | exact | exact |
| `line1\r\nline2` | `line1\nline2` | exact | exact | exact |
| `"5"` (numeric-looking string) | `"5"` | `"5"` | **number `5`** | `"5"` |
| leading and trailing spaces | exact | exact | exact | exact |

The second decode is lossy (`&amp;` and `&` both come out as `&`), so it can't be reversed reliably afterwards. In HTML `Comment Text`, it would turn escaped text such as `&lt;` into live markup.

### Why (source locations)

- **SheetJS 0.20.x.** In `bits/67_wsxml.js`, every `<v>` is decoded once (line 401). A `t="str"` cell is then decoded a second time with `unescapexml(utf8read(p.v), true)` (line 467). The `true` flag also rewrites `\r\n` → `\n`. This is unconditional (no read option controls it) and still present on master as of commit `1782abbc` (2025-12-01) ([source](https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/bits/67_wsxml.js)). 0.18.5 uses `utf8read(p.v)` only, which is why it is exact.
- **exceljs 4.4.0.** `lib/xlsx/xform/sheet/cell-xform.js:371`, `case 'str': model.value = utils.xmlDecode(model.value)`, is applied after the SAX parser has already decoded entities. `xmlDecode` (`lib/utils/utils.js:117`) handles only named entities, so `&#39;` survives.
- **xlsx-populate 1.21.0.** `lib/XmlParser.js:39` passes every text node through `_covertToNumberIfNumber`. A `t="str"` value like `5` becomes a number.
- **read-excel-file 9.3.10.** The README says: "By default, it automatically trims all string values. To disable this behavior, pass `trim: false` option." It returns `null` for empty cells.

## Runtime and platform constraints

- **Next.js bundling.** SheetJS 0.20.3, SheetJS 0.18.5, exceljs, read-excel-file and xlsx-populate built and ran under Next.js 16.3.7 Turbopack without any `serverExternalPackages` entry. None of them is on Next's built-in auto-external list (`node_modules/next/dist/lib/server-external-packages.jsonc`). Next bundles dependencies of Server Components and Route Handlers automatically ([Next docs: serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)). A server action invocation was not tested directly; only the route handler was.
- **Upload size.** The largest fixture is 183 KB. The server action default body limit is **1 MB**, configurable via `serverActions.bodySizeLimit` (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`). Vercel Functions cap request bodies at **4.5 MB** and bundles at 250 MB uncompressed ([Vercel Functions limits](https://vercel.com/docs/functions/limitations)).
- **Node APIs.** exceljs depends on `archiver`, `unzipper`, `tmp`, `readable-stream` and `fast-csv` (Node streams and filesystem). read-excel-file ships separate `node`, `browser`, `universal` and `web-worker` entry points; `universal` takes only `ArrayBuffer`/`Blob`. SheetJS reads a `Uint8Array` with `{type:'array'}`, so it doesn't need `Buffer`. Only the Node runtime was tested here; Edge was not.
- **Parse time.** In plain Node 22, Ben (1,248 rows, 183 KB) took roughly 50-120 ms for SheetJS, read-excel-file and node-xlsx, 190 ms for xlsx-populate and 300 ms for exceljs (single cold run on a Mac, indicative only).

## Trade-offs (no pick)

- **Exact on every fixture cell, apart from `""` → `null`:** read-excel-file with `{trim:false}`, and xlsx-populate. xlsx-populate would coerce a numeric-looking string, has no types, and has had no release since 2020.
- **Exact including `""`:** SheetJS 0.18.5 from npm, which has two high-severity advisories and no npm release since 2022.
- **Alter content on these files:** SheetJS 0.20.3 (the maintained SheetJS build), node-xlsx and exceljs. All three double-decode `&amp;`. SheetJS also normalises `\r\n`. Neither behaviour can be turned off with an option.
- **Hand-rolled reader:** a hand-rolled reader of the kind used for the reference grid (fflate + a small XML parser) reproduced openpyxl exactly. The format uses only `t="str"` and numeric cells in a single sheet. It would have to handle any other cell type (`s`, `inlineStr`, `b`) if a file were ever re-saved by Excel. Not tested.

Scratch harness (not committed): unzip reference, per-library diff, synthetic-cell probe and a Next.js route handler, all run from a temp directory outside the repo.
