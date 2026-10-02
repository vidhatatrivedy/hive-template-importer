# Notes

Submission notes for the Hive Inspect take-home. The live app is at https://hive.vidhatatrivedy.com, with no login. It opens on InterNACHI Residential, already imported.

Contents:
- what was built and why the Trust Report is the centre of it
- how the importer classifies what it finds
- the schema
- the UI decisions
- how it was built (what a human did and what agents did)
- how it was checked
- cuts and limitations
- time spent and credits

The full reasoning behind each decision is in the GitHub issues linked below and in [`docs/adr/`](docs/adr/).

## The idea: an import you can trust

The customer is leaving Spectora with a template they've tuned for four years. Their fear isn't "will it import", but "did *all* of it survive, unchanged?".

Before writing code, I ran six Spectora exports through Hive's own importer ([`docs/research/hive-importer-findings.md`](docs/research/hive-importer-findings.md)).
- **What it gets right:** counts and order. InterNACHI Residential arrives as 392 of 392 rows.
- **What it changes without saying so:**
  - Number fields lose their units.
  - YouTube embeds are dropped.
  - Headings are flattened.
  - Empty Sections vanish.
- **Nothing tells the user any of this.** There's no summary, and a wrong file gives a raw `Import Failed 'Section Name'`.

So the gap is proof, not fidelity, and that set the goal: import faithfully, then **show the evidence**. The chosen improvement is the **Import Trust Report**, and the rest of the design follows from it.

- **The parser is deterministic: no LLM in the import path.** A model could invent a Section or silently drop a row, and "the model usually gets it right" isn't evidence. AI was used heavily to *build* the importer, but not to *run* it.
- **No Source row is ever skipped.** Every non-blank row becomes exactly one Comment, even when a value is bad. The bad value gets a fallback and is flagged, so reconciliation is always N rows → N Comments. Fully blank rows are counted and ignored.
- **The original is kept beside the result.** Every Comment keeps its raw export row (its **Source row**) and its untouched `Comment Text` cell, so the stored value can always be compared with the source.

### Before anything is stored: the Import review

Upload → the server parses the file and writes nothing → **Import review** → **Import** commits in one transaction → the new Template opens with its Trust Report open.

The review shows:
- the name, prefilled from the filename with the `-YYYY-MM-DD` export date stripped (Hive keeps it)
- the counts (rows read → Sections / Items / Comments)
- the Import issue counts by severity
- whether this exact file (by SHA-256) was imported before

Hovering a warning count lists each warning with its location. Hovering a notice count lists each kind of notice with how often it occurs. **Cancel** stores nothing. **Import** sends the file again and the server parses it again: the parser is deterministic, and the file's hash must match the review's, so nothing is held on the server in between.

The review deliberately shows **no verdict**. The Trust Report's ✓ means "the stored Comment matches its Source row", and before Import nothing is stored, so a verdict there would only compare the file with itself. It would claim proof the app doesn't have yet.

### After Import: the Trust Report

The report belongs to the Import run and checks Version 1, recomputed from the database each time it opens. From top to bottom:
1. **Summary:**
   - the file, its date and short SHA-256
   - rows read → blank rows → Comments stored
   - how many values were decoded
   - the verdict: **"392 / 392 rows verified"**
2. **Reconciliation** by Section, expandable to Items, with ✓ or ✗ on each. **✗ always means an importer bug**, never "expected".
3. **Import issues**, grouped by kind and filterable by severity and class. Each one opens its Source row.
4. **External assets**: images and videos still hosted on `cdn.spectora.com` or YouTube, grouped by host. They break if the customer's Spectora account goes away.
5. **Kept but not used**: columns stored raw that the app doesn't act on, such as estimates and default photos.
6. **Missing from export**: always shown. It lists what Spectora never puts in the file.

The **Source row view** shows, for any imported Comment:
- raw → stored for each normalised field
- the raw HTML with every sanitiser cut struck through and labelled
- the rendered result
- every raw cell of the row

A row passes only when every difference between its Source row and the stored Comment is accounted for. The test suite uses this same rule, so the report and the tests prove the same claim.

**It caught a real bug.** On 2 Oct I exported a template none of the fixtures resembled (2,043 rows). It verified only **2039 / 2043**:
- Four rows had a Recommendation of `"Masonry-restoration "`, with a trailing space.
- The importer trimmed it correctly, but didn't log the trim the way it does for names.
- The report refused to call an unlogged change "verified".

The fix was one notice and a test (`4485221`), and the file now verifies 2043 / 2043.

## How the importer classifies what it finds

Every finding falls into one of three tiers.

| Tier | Meaning | What happens |
|---|---|---|
| **Rejection** (the only "error") | The file can't be imported faithfully at all | Nothing is stored and no Import run is left. You get a specific message saying what to do instead |
| **Warning** | What the reader now sees means something different: a fallback was applied, content was removed, or the structure needs a human to look | The file imports. The warning is listed with its row |
| **Notice** | It looks the same: a cosmetic or lossless change, or a heads-up | The file imports. The notice is listed, quieter |

**Rejections are file-level only.** There are six:
1. Not an xlsx (a random file, a real legacy `.xls`, CSV or PDF).
2. **The plain-text export.**
3. Over 4 MB (checked in the browser and on the server).
4. A required column is missing; each missing one is named.
5. No data rows.
6. A corrupt workbook.

A bad *row* never rejects the file. Rejecting a 1,248-row template over one odd cell would be less faithful, not more.

**Telling the plain-text export apart** was the subtlest of these. It has the same 42 columns, with HTML stripped and link URLs lost. The rule is: no `Comment Text` contains a tag, **and** at least one bare `&` appears in the name columns. Measured on the fixtures, that's 0 cells across the six HTML exports and 282 in the plain-text one. A file with neither carries the same information in both formats, so it imports.

**Each issue also has a class**, which answers "whose doing is this?":

| Class | Meaning | Examples |
|---|---|---|
| **Changed** | We altered a value | whitespace trimmed, `t`/`f` default read as a boolean, unknown Comment type → `info`, a `<script>` removed |
| **Unsupported** | It's in the file, but we don't read or use it | an extra sheet, an unknown column, custom estimates, a non-YouTube iframe turned into a link |
| **Missing from export** | Spectora never put it in the file | an empty Section, Section settings, an empty YouTube wrapper, an expected column that's absent |
| **Check** | Nothing was changed, but it looks suspicious | a duplicate Comment, a split run, a checkbox default that isn't among its options |

The brief asks to distinguish information missing from the export from information we don't support. That's the line between the **Missing from export** and **Unsupported** classes.
- **Missing from export:** the Radon template I built had 4 Sections, two of them empty, and the export has 2. No importer can recover those, so the report says so.
- **Unsupported:** content that *is* in the file but that we don't use stays in the Source row and is listed under **Kept but not used**.

There are 30 issue kinds, each with a fixed severity, class and message in [`src/core/import/catalogue.ts`](src/core/import/catalogue.ts). A test checks that the catalogue is complete. The taxonomy was decided in [#11](https://github.com/vidhatatrivedy/hive-template-importer/issues/11) and refined during the build. For example, removing a `url(…)` style became its own warning instead of being folded into a quiet notice, because a security-relevant removal shouldn't be collapsed by default.

**How values are normalised** ([#9](https://github.com/vidhatatrivedy/hive-template-importer/issues/9)):
- **Order of steps:** entities are decoded, then whitespace is trimmed, then the value is interpreted.
- **Which fields:** only the fields the editor shows are normalised. Everything else stays raw in the Source row.
- **Trims:** every trim is a notice, because the visible text changed.
- **Order of rows:** row position in the file is the order. Spectora's `Order` column is mostly ties: 634 of 798 rows read `5` in Room-by-Room.
- **Grouping:** rows are grouped by *contiguous* runs of Section and Item names. A name that reappears later is imported as a separate node with a warning, never silently merged.
- **Duplicates** are kept and flagged.

**Comment HTML** ([#10](https://github.com/vidhatatrivedy/hive-template-importer/issues/10), [ADR 0001](docs/adr/0001-sanitise-comment-html-by-cutting-source-spans.md)) was the hardest import problem.
- **Why off-the-shelf sanitisers don't fit.** They parse and re-serialise the whole fragment. Measured on the 2,823 non-empty Comment Text cells in the five HTML fixtures, DOMPurify returned only 982 unchanged: it rewrites every U+00A0 and every CRLF. That would make every Comment "changed" and the Trust Report meaningless.
- **What we built instead.** A small pass over parse5 cuts only the disallowed spans *from the original string* and logs each cut as it makes it. Untouched HTML stays byte-identical, and every change has a logged reason.
- **What's kept:**
  - an allowlist of formatting tags, links and images
  - inline styles, limited to layout and typography properties
  - YouTube iframes
- **What changes:**
  - Editor leftovers (`fr-original-style`, `draggable`, `data-*`) are removed as one notice per Comment.
  - Other iframes become links.
  - `script`, `style` and form elements are removed.
- **Images and videos** stay hotlinked to their original host and are listed in the report as External assets. Copying them into storage was cut.
- **When a Comment is shown,** DOMPurify runs again as a second layer.

## Schema

Decided in [#12](https://github.com/vidhatatrivedy/hive-template-importer/issues/12) and [ADR 0002](docs/adr/0002-each-version-owns-a-normalised-row-tree.md).

```
templates → versions → sections → items → comments → comment_options
import_runs → source_rows, import_issues → html_cuts
```

**How we got there:**
- **The starting rule:** fully normalised. Every fact is stored once, children point at their parent, nothing derivable is stored, and jsonb is used only for write-once evidence (raw rows and issue detail).
- **Where content hangs.** The first sketch hung Sections off the Template. But the Save model was already decided:
  - Unsaved edits live only in the browser.
  - Every Save makes a Version.
  - The latest Version is the saved state.

  So a Template-level "live tree" would just be a second copy of the latest Version. Content therefore hangs off the **Version**, and each Version owns a complete row tree. Save, Restore and Duplicate each write a whole new tree in one transaction, and a trigger makes old Versions immutable.
- **Rejected options:**
  - **A live tree plus a jsonb snapshot per Version:** a second schema that drifts.
  - **Structural sharing between Versions:** reference counting and diffing on every Save, to save a few hundred KB against a 500 MB budget.
- **Import evidence isn't Version content.** Source rows, issues and HTML cuts belong to the **Import run**. Comments in any Version or Copy point at their Source row by id instead of copying it. That's how an edited, restored or copied Comment can still show where it came from.
- **A Copy is genuinely independent.** It has its own Version 1, equal to the source's latest *saved* Version, and records which Template and Version it came from. Deleting the source leaves the Copy and its evidence intact.
- **All database access goes through Postgres functions** ([ADR 0003](docs/adr/0003-all-database-access-through-postgres-functions.md)). Each write is one `rpc()` call, so it's one transaction: supabase-js can't group several calls. Reads return one jsonb value, because plain selects are silently cut off at 1,000 rows and Ben's template has 1,248. The browser never holds a Supabase key.

## UI decisions

Recorded in [#5](https://github.com/vidhatatrivedy/hive-template-importer/issues/5), [#7](https://github.com/vidhatatrivedy/hive-template-importer/issues/7) and [#15](https://github.com/vidhatatrivedy/hive-template-importer/issues/15), and in [`docs/spec/design.md`](docs/spec/design.md).

- **Spectora's columns, not Hive's tree.** Sections │ Items │ Comments │ detail, left to right. A template is a deep hierarchy edited one branch at a time, and side-by-side columns keep the path visible. Three layouts were prototyped; "collapsing columns" was chosen.
- **The look:** a quiet, Apple-like glass style. Monochrome, 12px base type, frosted panes, the way a multi-pane agent window stays calm with three or four panes open.
  - **Comment types are told apart by weight and fill, not colour:** defect filled, limitation grey, info outline.
  - **Severity is shown the same way:** warnings emphasised, notices muted.
- **Grouped for reading, file order for storage.** Comments show grouped Informational / Limitations / Deficiencies, like Spectora and Hive, but the stored order is always the file's. The Trust Report proves that order.
- **No WYSIWYG editor.** Comment text is edited as HTML source beside a live, sanitised preview. A rich-text editor would parse and re-serialise the HTML, so one keystroke could silently rewrite a four-year-old Comment. Before Save, a notice lists anything the sanitiser will remove.
- **Edits are explicit.**
  - Changes stay unsaved until **Save**, which makes one Version. **Discard** is the undo.
  - Leaving with unsaved changes asks first.
  - A Save made from an out-of-date Version is refused with "Load latest", never merged or overwritten.
- **The evidence is one click away, not in the way.** The Trust Report and Versions are glass sheets toggled from the header.
- **Changed after the first manual test:**
  - Collapsing columns became an opt-in setting.
  - A Light / Dark / System switch was added, saved per browser.
  - The collapse is now animated.
  - Hover lists on the review's counts were added.
- **Desktop only,** at about 1200px wide and up.

## How it was built

I made the decisions, and AI agents wrote the code. Here's which was which.

**Human in the loop (about 14 hours of my time):**
- **Product research:**
  - Read the brief.
  - Exported six templates from a Spectora trial. Two were edited on purpose to test edge cases: an Item named `Dev`, and a Radon template with empty Sections.
  - Ran all six through Hive's importer and wrote up what it does.
- **Spec.** Every functional and technical decision was made in a grilling session with Claude Code: 3 research tickets, 10 decision tickets, 1 layout prototype and 3 ADRs, consolidated into [`docs/spec/`](docs/spec/). Claude recommended, and I decided, sometimes against the recommendation (see below).
- **Tickets.** Six vertical slices (#17–#22) were specified, then split into 54 implementation tickets with native GitHub blockers.
- **Supervising the agents:**
  - smoke-testing the agent setup before the first run
  - starting each batch and checking its output
  - fast-forwarding `main` between batches
  - fixing the loop when it broke
- **Manual testing.** The first human click-through filed five UI tickets. I fixed YouTube playback and the alignment interactively, and found the Recommendation trim bug.
- **Deploy:** the prod Supabase project in us-east-1 and Vercel in iad1.

**Away from keyboard (Sandcastle):**
- All 59 implementation tickets (#23–#81) were built by an implement → review loop in Docker. It ran overnight on 1–2 Oct, in batches of 3–15 tickets, and switched between Claude Code (Opus 5.5) and Cursor (grok-4.7).
- Each ticket got one `RALPH:` implementation commit, written test-first with the `tdd` skill, then a review pass with the `code-review` skill. Almost every review changed something, and several fixed real bugs. The first review found that removing an attribute could glue the next attribute onto the tag name.
- **A ticket closes only after its review passes.** The loop closes it, not the agent. A failed phase leaves the ticket open with a comment naming its commits.

**What the AFK loop taught us** (the fixes are in [`.sandcastle/`](.sandcastle/)):
- **The pre-run smoke test caught three run-breakers.**
  - `typecheck` failed on a fresh checkout.
  - Cursor rejected the model-id format we used.
  - A new run forks from `HEAD`, so tickets closed on unmerged branches would build on code that wasn't there.
- **Agents first closed tickets before review.** That was moved into the loop, after the review succeeds.
- **Cursor's 120 KiB prompt cap.** The implement prompt now lists issues without their bodies (124 KB → 9 KB), and an oversized review prompt gets a per-file diff summary instead.
- **Silent Cursor reviews got killed.** They went quiet for 10+ minutes while working, and the idle timeout stopped them. The timeout is now 30 minutes.
- **An agent left `npm run dev` running.** Background processes must now be stopped before committing. An implement failure is caught, and the next agent cherry-picks the unreviewed commits instead of redoing them.
- **Speed:** Claude averaged 6–11 minutes per ticket. Cursor took about 35 minutes at `high`, and 10–26 minutes at the `-fast` settings. Almost all of Cursor's time was in reviews, not test runs.

**Course corrections:**
- **Agents got the dev database.** I first withheld it, because the secret key is full access. I reversed that so database tickets could run AFK too, limited to a disposable dev project with no prod key and one run at a time.
- **No generated Supabase types.** They needed Docker or an account-wide token, so I dropped them; zod validates every database result anyway.
- **No Trust Report at the review stage.** It would have claimed a verification that hadn't happened.
- **A looser YouTube iframe sandbox.** It's now `allow-scripts allow-same-origin allow-presentation allow-popups`. That's a deliberate trade-off: only youtube.com and youtube-nocookie.com iframes survive the sanitiser, so their scripts run on YouTube's origin, not ours.

The reusable setup is all in the repo:
- [`AGENTS.md`](AGENTS.md), provider-neutral. `CLAUDE.md` only imports it.
- the skills in [`.agents/skills/`](.agents/skills/)
- the loop and its prompts in [`.sandcastle/`](.sandcastle/)
- the issue-tracker conventions in [`docs/agents/`](docs/agents/)

## How it was checked

Decided in [#14](https://github.com/vidhatatrivedy/hive-template-importer/issues/14).

**The fixtures** are six real Spectora exports, plus Spectora's plain-text export, in [`fixtures/spectora/`](fixtures/spectora/). Their quirks are described in the [README](fixtures/spectora/README.md).
- **InterNACHI Residential** is the primary fixture and the seed.
- **Ben Gromicko's** is the stress test: 1,248 rows, images, YouTube embeds, headings and true duplicates.
- **Residential** has my `Dev` Item inserted first.
- **Radon** has empty Sections.
- **Commercial** and **Room-by-Room** cover more shapes.

**The preservation check.** `toExportRows` rebuilds the 42 export columns from the stored tree plus the Source rows. The check then fails on any **Unexplained difference**:
- a changed cell that no logged trim, decoding rule, sanitiser cut or fallback accounts for
- a Source row with no Comment
- anything out of row order

Counts alone don't pass it. It's the same `reconcile` function the Trust Report uses. Mutation tests confirm it catches deliberately broken imports.

`npm run verify` output:

```
file                                                         rows  comments  sections  items  explained  unexplained  warnings  notices  rejection
Ben Gromicko's Template for Home Inspections-2026-09-30.xls  1248      1248        17    133        626            0         2       75
InterNACHI Commercial Template-2026-09-30.xls                 406       406        15     67        208            0         1        9
InterNACHI Residential -2026-09-30 (plain text).xls             0         0         0      0          0            0         0        0  plain-text-export
InterNACHI Residential -2026-09-30.xls                        392       392        13     69        264            0         1       13
Radon Inspection-2026-09-30.xls                                10        10         2      3          0            0         0        1
Residential Template-2026-09-30.xls                           395       395        13     70        264            0         1       14
Room-by-Room Residential Template-2026-09-30.xls              798       798        22    136        323            0         7       22
```

**`npm test`** (417 passed, 1 skipped; offline, and runs in CI):
- exact counts on every fixture
- the round trip
- pinned quirks:
  - `Dev` comes first
  - Ben's rows 306/308 are both kept
  - `&amp;` is decoded
  - Radon's missing Sections are reported
- each of the six rejections
- the sanitiser against the fixtures and known attack strings
- catalogue completeness
- a drift test between the issue kinds in code and in the database

**`npm run test:db`** (33 tests, against a real Supabase project):
- the round trip through the database for all six fixtures
- edit persistence: rename, text, reorder, add and delete → Save → reload equals what was submitted, as Version 2
- Copy independence in both directions, including after the source is deleted
- Restore
- stale-Save refusal
- that the publishable key can read nothing

**Two failure cases:**
1. **The plain-text export is rejected** with a message saying how to re-export.
2. **The trim bug on an unseen export:** the report showed 2039 / 2043, and the cause and fix are described above.

**By hand:** a full click-through of import, the Trust Report, editing, Save and Restore, Duplicate and Delete, locally and on prod.

## Cuts and why

- **Section and Item settings** (icon, Standards of Practice, Reminders, Optional/Included): the export doesn't carry them, so the editor would always show them empty. The Trust Report lists them under Missing from export.
- **Copying images and videos into our storage:** they're kept hotlinked and listed as External assets. It's the most valuable next step, because those links die with the customer's Spectora account.
- **WYSIWYG editing:** see UI decisions.
- **Auth:** reviewers share one workspace. There's no in-app reset, so one reviewer can't wipe another's work; `npm run seed` resets it.
- **Also cut:**
  - search across a Template
  - mobile and narrow layouts
  - duplicating a Section, Item or Comment inside a Template
  - drag-and-drop reordering (↑/↓ instead)
  - Version diffs
  - merging concurrent edits (the stale Save is refused instead)
  - acknowledging or dismissing Import issues
  - exporting the Trust Report

## Supported input and known limitations

- **Supported input:** Spectora's **Export to spreadsheet → Export HTML Text** file (an xlsx named `.xls`) of up to 4 MB.
  - Only the first sheet is read; an extra sheet is a warning.
  - Headers are matched by name, ignoring case, order and extra columns.
  - Only the five core columns are required.
- **An export re-saved in Excel is untested.** The test exists but is skipped until such a file is added to the fixtures.
- **Unsaved edits live only in the tab.** Closing it triggers the browser's leave prompt; a crash loses them. The browser's Back and Forward buttons aren't guarded, because the App Router can't cancel them. Pane toggles stay on the same path, so Back usually only opens or closes a sheet.
- **The Trust Report always describes Version 1, as imported.** Later edits aren't re-verified against the source.
- **Cosmetic:**
  - The Collapse columns ⓘ tooltip covers half of the System theme button.
  - Clicking an already-selected Item doesn't collapse its column, because the row turns into its rename field.

## Time spent

About 14 hours of my own time, between 30 Sep and 3 Oct. That covers product research, every spec decision, supervising the agent runs, manual testing and deploy. The implementation itself ran AFK on top of that, overnight between 1 and 2 Oct.

## Credits

- **Libraries:**
  - Next.js and React
  - Supabase (supabase-js, CLI)
  - [read-excel-file](https://gitlab.com/catamphetamine/read-excel-file) (parsing)
  - [parse5](https://github.com/inikulin/parse5) (source-span sanitiser)
  - [DOMPurify](https://github.com/cure53/DOMPurify) (render-time layer)
  - [entities](https://github.com/fb55/entities)
  - zod, Tailwind CSS, Vitest, jsdom
  - write-excel-file (sample files), tsx
- **Agent tooling:**
  - [Sandcastle](https://github.com/mattpocock/sandcastle) (`@ai-hero/sandcastle`) for the AFK loop
  - [mattpocock/skills](https://github.com/mattpocock/skills): wayfinder, grill-with-docs, to-spec, to-tickets, tdd, code-review, handoff and others
- **AI:** Claude Code (Claude Opus 5.5) and Cursor (grok-4.7).
- **Fixtures:**
  - templates from Spectora's library (InterNACHI Residential and Commercial, Room-by-Room, Ben Gromicko's), exported from a Spectora trial account.
  - Two templates edited by me: Residential and Radon.
