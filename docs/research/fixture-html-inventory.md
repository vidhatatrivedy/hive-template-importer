# Fixture HTML inventory and sanitiser options

Answers issue #4. Profiled on 2026-09-30 with a throwaway script (SheetJS `xlsx` + `htmlparser2` + `parse5`, run outside the repo) over **every cell of every column** in the six files in `fixtures/spectora/`. Facts only; the sanitising policy is decided in a later ticket. Complements the "Rich content" section of `spectora-export-format.md`.

Conventions: counts are **element / attribute occurrences** unless marked "rows". Numbers in brackets are example **1-based sheet row numbers** (row 1 = header). Fixture abbreviations:

| Abbr | File | Data rows | `Comment Text` with HTML / plain / empty |
|---|---|---|---|
| Ben | `Ben Gromicko's Template for Home Inspections` | 1248 | 1223 / 3 / 22 |
| Com | `InterNACHI Commercial Template` | 406 | 214 / 106 / 86 |
| Res | `InterNACHI Residential` | 392 | 198 / 111 / 83 |
| RT | `Residential Template` | 395 | 198 / 111 / 86 |
| RbR | `Room-by-Room Residential Template` | 798 | 365 / 293 / 140 |
| Rad | `Radon Inspection` | 10 | 1 / 0 / 9 |

"Plain" = non-empty with no tag. No plain-text cell contains a newline. Longest cell: 2,435 chars (Ben).

## 1. Which columns carry HTML

- **Only `Comment Text` contains markup.** No tag appears in any other column in any fixture, including `Section Name`, `Item Name`, `Comment Name`, `Default Photo N Caption`.
- Name columns carry the entity `&amp;` only (see §6). No `<`/`>` characters at all in names.
- `Default Photo 1` (Ben only, 18 rows [38, 39, 213, 214]) holds bare URLs on `cdn.spectora.com`, not HTML.

## 2. Tags (`Comment Text`)

| Tag | Ben | Com | Res | RT | RbR | Rad |
|---|---|---|---|---|---|---|
| `p` | 1700 [2, 3, 7, 8] | 249 [11] | 244 [12] | 244 [15] | 445 [11] | 6 [10] |
| `a` | 42 [10, 11, 12, 17] | 34 [17, 28] | 43 [21, 25] | 43 [24, 28] | 81 [17, 28] | 1 [10] |
| `br` | 79 [8, 9, 10] | - | - | - | - | - |
| `li` | 89 [7, 10, 91] | - | - | - | - | - |
| `ol` | 15 [7, 91, 104] | - | - | - | - | - |
| `ul` | 7 [10, 283, 490, 607] | - | - | - | - | - |
| `strong` | 9 [7, 8, 9, 10] | - | 1 [126] | 1 [129] | - | 3 [10] |
| `img` | 13 [8, 9, 10, 11] | - | - | - | - | - |
| `span` | 7 [10, 563] | - | - | - | - | - |
| `div` | 7 [12] | 1 [318] | 1 [311] | 1 [314] | 7 [209, 264, 319, 374] | - |
| `iframe` | 2 [10] | - | - | - | - | - |
| `h3` | 1 [12] | - | - | - | - | - |

Not present anywhere: `script`, `style`, `object`, `embed`, `video`, `table`, `em`/`i`/`b`/`u`, `h1`-`h2`/`h4`-`h6`, `font`, `hr`, forms, SVG/MathML, HTML comments, doctype, uppercase tag names, XHTML `<br />` syntax.

## 3. Attributes

| Attribute | Ben | Com | Res | RT | RbR | Rad |
|---|---|---|---|---|---|---|
| `a[href]` | 42 | 34 | 43 | 43 | 81 | 1 |
| `a[target]` (`_blank`) | 39 [10, 11] | 30 [28, 60] | 39 [21, 25] | 39 [24, 28] | 65 [28, 63] | 1 [10] |
| `a[rel]` (`noopener noreferrer`) | 35 [10, 11] | - | - | - | - | - |
| `a[style]` | 36 [10, 11] | - | - | - | - | - |
| `a[fr-original-style]` (always `""`) | 36 [10, 11] | - | - | - | - | - |
| `a[draggable]` | 18 [10, 11, 112] | - | - | - | - | - |
| `img[src]` | 13 [8, 9, 10] | - | - | - | - | - |
| `img[style]` | 12 [8, 9, 10] | - | - | - | - | - |
| `img[draggable]` | 7 [8, 9, 10] | - | - | - | - | - |
| `img[alt]`, `img[width]`, `img[height]` | 1 each [12] | - | - | - | - | - |
| `span[style]` | 7 [10, 563] | - | - | - | - | - |
| `span[class]`, `span[contenteditable]`, `span[draggable]` | 2 each [10] | - | - | - | - | - |
| `iframe[src]`, `[width]`, `[height]`, `[frameborder]`, `[allowfullscreen]`, `[class]` | 2 each [10] | - | - | - | - | - |
| `ol[start]` | 5 [121, 141, 278] | - | - | - | - | - |
| `div[class]`, `div[style]` | - | 1 [318] | 1 [311] | 1 [314] | 7 [209, 264] | - |
| `div[data-testid]` | 6 [12] | - | - | - | - | - |
| `div[data-mesh-id]` | 3 [12] | - | - | - | - | - |
| `div[data-motion-part]` | 1 [12] | - | - | - | - | - |

Not present anywhere: `on*` event handlers, `javascript:`/`data:` URLs, `id`, `name`, `srcset`, `title`.

## 4. Inline style properties and classes

Values are verbatim. All in Ben except the `youtube-embed-wrapper` block.

| Property: value | Ben | Com | Res | RT | RbR |
|---|---|---|---|---|---|
| `color: rgb(25, 118, 210)` (on `a`) | 36 [10, 11, 12, 17] | - | - | - | - |
| `color: inherit`, `background-color: initial` (on `span`) | 5 each [563] | - | - | - | - |
| `width: 200px` / `217px` / `263px` / `435px` / `452px` / `500px` / `532px` (on `img`) | 6 [8, 10, 77] / 1 [9] / 1 [11] / 1 [111] / 1 [115] / 1 [116] / 1 [46] | - | - | - | - |
| `display: block` / `inline-block` | 5 [8, 9, 10] / 9 [11, 46, 77] | - | - | - | - |
| `vertical-align: top` / `bottom` | 3 [8] / 9 [11, 77] | - | - | - | - |
| `margin: 5px auto 5px 0px` / `5px 5px 5px 0px` | 3 [8] / 7 [77, 78] | - | - | - | - |
| `margin-left: 5px`, `margin-right: 5px` | 2 each [11, 46] | - | - | - | - |
| `max-width: calc(100% - 5px)` / `calc(100% - 10px)` | 10 [8, 77] / 2 [11, 46] | - | - | - | - |
| `text-align: left` / `center` | 10 [8, 77] / 4 [10, 11, 46] | - | - | - | - |
| `float: left` | 7 [77, 78, 85, 86] | - | - | - | - |
| `clear: both` (on `span.fr-video`) | 2 [10] | - | - | - | - |
| `position: relative; padding-bottom: 56.25%; padding-top: 30px; height: 0; overflow: hidden` (on `div.youtube-embed-wrapper`) | - | 1 [318] | 1 [311] | 1 [314] | 7 [209, 264, 319, 374, 429, 484, 623] |

| Class | Ben | Com | Res | RT | RbR |
|---|---|---|---|---|---|
| `span.fr-video` + `span.fr-draggable` | 2 [10] | - | - | - | - |
| `iframe.fr-draggable` | 2 [10] | - | - | - | - |
| `div.youtube-embed-wrapper` | - | 1 [318] | 1 [311] | 1 [314] | 7 [209, 264, 319, 374] |

**Froala markers:** `fr-original-style`, `class="fr-video fr-draggable"`, `class="fr-draggable"`, `contenteditable="false"`, `draggable`. **Non-Froala editor residue:** `data-testid`, `data-mesh-id`, `data-motion-part` in Ben row 12 (Wix-style names from a paste).

## 5. Embeds, images and link hosts

**Embeds**

| Where | What | Rows |
|---|---|---|
| Ben › Buy Back Guarantee › "We'll Buy Your Home Back" | 2 × `<span class="fr-video …"><iframe src="https://www.youtube.com/embed/_ErxoNiGyzI">` and `…/embed/5pQpMt8_zx8`, `width=560 height=315` | Ben 10 |
| `div.youtube-embed-wrapper` in Com, Res, RT, RbR | **Wrapper only: the iframe is already absent in the export.** The div contains a single U+00A0. The comment is otherwise plain text + `p`. | Com 318, Res 311, RT 314, RbR 209, 264, 319, 374, 429, 484, 623 |

**Images:** all 13 `img` are in Ben, all `https://cdn.spectora.com/editor_assets/images/000/…/original/<file>?<unix-ts>` (rows 8, 9, 10, 11, 12, 46, 77, 78, 85, 86, 111, 115, 116). Two (rows 10, 11) are wrapped in `<a href>`. Four filenames contain `%E2%80%AF` (percent-encoded U+202F) [77, 78, 85, 86]. Only row 12 has `width`/`height` attributes (131 × 131); the rest size via `style`.

**`a[href]` hosts** (scheme as written; no relative, `mailto:`, `tel:` or `javascript:` links):

| Host | Ben | Com | Res | RT | RbR | Rad |
|---|---|---|---|---|---|---|
| `https://www.nachi.org` | 26 [10, 11, 17] | - | 2 [377, 378] | 2 [380, 381] | 2 [783, 784] | - |
| `http://www.nachi.org` | 10 [10, 11, 112] | - | - | - | - | - |
| `http://www.bigbeninspections.com` | 1 [12] | - | - | - | - | - |
| `http://www.cpsc.gov` | 1 [563] | - | - | - | - | - |
| `https://www.proreferral.com` | 2 [811, 1223] | 1 [324] | 1 [317] | 1 [320] | 7 [215, 270] | - |
| `https://www.thisoldhouse.com` | 2 [820, 1232] | 5 [28, 62] | 5 [28, 73] | 5 [31, 76] | 27 [28, 70] | - |
| `http://www.familyhandyman.com` | - | 11 [61, 65] | 13 [21, 25] | 13 [24, 28] | 19 [69, 73] | - |
| `https://www.youtube.com` (`/watch?v=` links, not embeds) | - | 2 [404, 405] | 3 [340, 364, 365] | 3 [343, 367, 368] | 3 [182, 183, 748] | - |
| `http://www.lowes.com` | - | 4 [29, 86] | 4 [35, 55] | 4 [38, 58] | 4 [29, 89] | - |
| `https://www.houselogic.com` | - | 2 [107, 108] | 2 [94, 96] | 2 [97, 99] | 2 [63, 64] | - |
| `http://porch.com`, `http://www.polybutylene.com` | - | 1 each [201] | 1 each [189] | 1 each [192] | 4 each [529, 544] | - |
| `http://www.bobvila.com`, `http://www.diynetwork.com`, `http://homeguides.sfgate.com`, `http://www.homedepot.com`, `http://www.kitchensource.com`, `http://energy.gov`, `https://www.directenergy.com` | - | 1 each | 1 each | 1 each | 1 each | - |
| `http://www.countertopguides.com`, `http://home.howstuffworks.com` | - | - | 1 each [337], [373] | 1 each [340], [376] | 1 each [740], [780] | - |
| `http://www.doityourself.com`, `https://www.handymanhowto.com` | - | - | 1 each [52], [50] | 1 each [55], [53] | - | - |
| `https://www.epa.gov` | - | - | - | - | - | 1 [10] |

External asset hosts (things the browser would fetch): `cdn.spectora.com` (13 `img` + 18 default-photo URLs, Ben only) and `www.youtube.com` (2 iframes, Ben 10). No others.

## 6. Entities and special characters

| What | Column | Ben | Com | Res | RT | RbR | Rad |
|---|---|---|---|---|---|---|---|
| `&amp;` (the **only** named entity; no numeric entities, no `&nbsp;`/`&lt;`/`&gt;`) | Section Name | 225 rows [277] | 75 [275] | 107 [93] | 107 [96] | 28 [109] | - |
| | Item Name | 301 [75] | 137 [35] | 158 [9] | 158 [12] | 280 [35] | - |
| | Comment Name | 35 [177, 183] | - | - | - | - | - |
| | Comment Text | 7 [816, 820] | 29 [14, 52] | 31 [13, 35] | 31 [16, 38] | 75 [14, 52] | - |
| **Raw, unencoded `&`** | Multiple Choice Options | 1 [570] | 3 [203, 233, 244] | 3 [196, 225, 235] | 3 [199, 228, 238] | 3 [144, 155, 662] | - |
| U+00A0 (raw character, not an entity) | Comment Text | 1059 rows [2, 3] | 125 [11] | 143 [11] | 143 [14] | 273 [11] | 1 [10] |
| CRLF inside cell | Comment Text | 11 [584, 586] | 73 [15, 21] | 41 [12, 70] | 41 [15, 73] | 77 [15, 21] | - |
| LF only | Comment Text | 46 [7, 10] | 132 [11] | 138 [16] | 138 [19] | 265 [11] | 1 [10] |
| Curly quotes `‘’“”` | Comment Text | 4 [12, 110] | 4 [259, 263] | 2 [249, 253] | 2 [252, 256] | - | 1 [10] |
| `®` | Comment Text | 8 [7, 13] | - | - | - | - | - |

So encoding differs by column: names and comment text are entity-encoded (`Knob &amp; Tube` style), while `Multiple Choice Options` is not (`Knob & Tube`, `T&B`, `Bradford & White`). No zero-width characters or BOMs.

## 7. Malformed or odd markup

- **No parse errors.** `parse5` (WHATWG parser) reports zero parse errors on all 2,199 HTML cells. A tag-stack check finds no unclosed, stray or misnested tags. The only implied closes are the void elements `br` (79) and `img` (13), written as HTML `<br>`, which is valid.
- **`p` inside `li`:** `<ol><li><p>…</p></li></ol>` [Ben 121, 141].
- **Deep `div` nest from a paste** with `h3`, `img` and `p` inside three levels of `div[data-*]` [Ben 12]. Includes an empty `<div data-motion-part="BG_MEDIA"><br></div>`.
- **Empty embed wrapper** `div.youtube-embed-wrapper` containing only U+00A0 (10 rows, see §5).
- **Spacer paragraphs** `<p><br></p>`: 35 rows in Ben [8, 9, 10, 11]. **`<p>` containing only U+00A0**: Res 368, RT 371, RbR 776.
- **Whitespace outside the markup** (leading/trailing `\n` or `\r\n` around the HTML): Ben 38 rows [584, 586], Com 201 [11], Res 170 [12], RT 170 [15], RbR 333 [11], Rad 1 [10].
- **Mixed paragraph separators:** Froala-style cells have no whitespace between tags (Ben); older stock cells separate `</p>` and `<p>` with `\n\n` (Res 21, Rad 10).

## 8. Server-side sanitiser options (Node)

Registry data fetched from `registry.npmjs.org` and `api.npmjs.org` on 2026-09-30. "Observed" = run in the scratch project against fixture rows Ben 10, Ben 12, Ben 563, Res 311 with default config.

| Library | Latest (published) | License | Weekly downloads | How it works |
|---|---|---|---|---|
| [sanitize-html](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html) | 2.17.7 (2026-08-13) | MIT | 12.9 M | String in, string out. Parses with `htmlparser2`; styles via `postcss`. No DOM needed. Lives in the ApostropheCMS monorepo. |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.16 (2026-09-23) | MPL-2.0 OR Apache-2.0 | 76.1 M | Needs a DOM `window`. On Node that means [jsdom](https://github.com/jsdom/jsdom) (30.1.1, 2026-09-22, MIT). |
| [isomorphic-dompurify](https://github.com/kkomelin/isomorphic-dompurify) | 4.4.0 (2026-09-25) | MIT | 6.6 M | Thin wrapper: DOMPurify + `jsdom ^30` pre-wired. |
| DOMPurify + [linkedom](https://github.com/WebReflection/linkedom) | linkedom 0.18.13 (2026-07-07) | ISC | 5.4 M | Lightweight DOM on `htmlparser2`. |
| [xss (js-xss)](https://github.com/leizongmin/js-xss) | 1.0.15 (2024-03-03) | MIT | 6.8 M | String in, string out. Own tokenizer (not a WHATWG parser); CSS via `cssfilter`. |
| [hast-util-sanitize](https://github.com/syntax-tree/hast-util-sanitize) / [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) | 5.0.2 (2024-10-25) / 6.0.0 (2023-08-26) | MIT | 14.2 M / 13.5 M | Sanitises a hast tree (parse with `hast-util-from-html`, which uses parse5). Schema defaults to GitHub's rules. |

### Can it report what it removed or changed?

| Library | Built-in report | Hooks / callbacks | Observed with defaults |
|---|---|---|---|
| sanitize-html | **None.** | `onOpenTag(tag, attribs)` / `onCloseTag(tag, isImplied)` see the **input** tag and attributes; `exclusiveFilter(frame)` sees each frame **after** attribute filtering and can drop it (`true`) or unwrap it (`"excludeTag"`); `transformTags`, `textFilter`. ([README: Filters, Advanced filtering](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html#filters)). A change log has to be derived: compare the input attributes from `onOpenTag` with the allow-list, or diff input and output. | Drops `img` and `iframe` (not in default `allowedTags`); strips `style`, `class`, `rel`, `data-*`. An `iframe` that is allowed but whose host is not in `allowedIframeHostnames` is kept as an **empty `<iframe></iframe>`** with `src` removed. Output writes `<img … />`. |
| DOMPurify (+ jsdom) | **`DOMPurify.removed`**: array of `{element}` or `{attribute, from}`. The README calls it "a little helper for curious minds" and says not to use it for security decisions ([README: "Okay, makes sense, let's move on"](https://github.com/cure53/DOMPurify#okay-makes-sense-lets-move-on)). Nodes a hook detaches itself are **not** recorded there. | `addHook` on `beforeSanitizeElements`, `uponSanitizeElement`, `afterSanitizeElements`, `beforeSanitizeAttributes`, `uponSanitizeAttribute`, `afterSanitizeAttributes`, and shadow-DOM equivalents ([README: Hooks](https://github.com/cure53/DOMPurify#hooks)). | Ben 10: `removed` lists both `iframe`s, `a[target]`, `a[fr-original-style]`, `span[contenteditable]`. Keeps `img`, `style`, `class`, `rel`, `draggable`, `data-*`. Res 311: nothing removed. |
| DOMPurify + linkedom | n/a | n/a | **Fails open.** `isSupported` is not `true`, and `sanitize()` returns the input unchanged (a test string with `<script>` and `onerror` came back verbatim). Source: `if (!DOMPurify.isSupported) return dirty;` in `dist/purify.es.mjs`. The README names only jsdom as recommended and warns that happy-dom "[is] not considered safe"; linkedom is not mentioned. |
| xss (js-xss) | None, but callbacks fire **per dropped item**. | `onTag`, `onTagAttr`, `onIgnoreTag` (tag not in allow-list), `onIgnoreTagAttr` (attribute not in allow-list), `safeAttrValue` ([README: Custom filter rules](https://github.com/leizongmin/js-xss#custom-filter-rules)). | Ben 10: `onIgnoreTag` reports `iframe`; `onIgnoreTagAttr` reports `a[draggable|fr-original-style|rel|style]`, `img[style|draggable]`, `span[class|contenteditable|draggable|style]`. Keeps `img`. |
| hast-util-sanitize | **None.** | Schema only (`tagNames`, `attributes`, `protocols`, `strip`, `clobber`, `required`, `ancestors`) ([readme](https://github.com/syntax-tree/hast-util-sanitize#api)). A change log requires diffing the tree before and after. | Drops `iframe`; keeps `img`, `h3`, `div`. |

### Other facts relevant to the choice

- **jsdom on older Node 22:** jsdom 30.1.1 declares `engines: node >=20`, but loading it via DOMPurify failed on Node 22.9.0 with `ERR_REQUIRE_ESM` (dependency `@asamuzakjp/css-color` `require()`s an ES module). It loaded on Node 22.23.1. jsdom 30 has 20 direct dependencies (includes `undici`, `parse5`, `css-tree`).
- DOMPurify's README: server-side use "really depends on _jsdom_ or whatever DOM you utilize", and older jsdom versions have known XSS vectors, so keep jsdom current.
- sanitize-html and linkedom both parse with `htmlparser2` (not the WHATWG algorithm); DOMPurify+jsdom and hast use `parse5` (WHATWG). On these fixtures parse5 raises no errors (§7), so parser choice did not change tag structure in the rows tested.
- Default configs disagree on the elements that actually occur here: `img` (sanitize-html drops; DOMPurify, xss, hast keep), `iframe` (all drop), `style` attribute (DOMPurify keeps; sanitize-html, xss drop). Every option needs an explicit allow-list for this content.

## Trade-offs (not a recommendation)

- A per-change import issue is easiest with **xss** (one callback per dropped tag or attribute) or **DOMPurify + jsdom** (`removed` plus hooks), and needs custom diffing with **sanitize-html** or **hast-util-sanitize**.
- DOMPurify's `removed` is documented as a convenience, not an audit trail, and misses hook-detached nodes; hooks are the documented extension point.
- sanitize-html and xss avoid a DOM dependency; DOMPurify's safety on Node is tied to the jsdom version.
- Silent failure modes seen: DOMPurify on linkedom returns input unchanged; sanitize-html leaves an empty `<iframe>` when only the host check fails.
