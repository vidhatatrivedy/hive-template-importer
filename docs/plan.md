# Working plan

State of the plan as of 2026-09-30, end of the exploration session. **Decided** items are settled. **Proposed** items are starting positions for the `/wayfinder` + `/grill-with-docs` session, which turns them into the functional and technical spec (and ADRs). Once decided there, a decision lives in its wayfinder ticket or ADR, not here.

## Workflow from here

1. `/wayfinder` map, destination: *functional + technical specification* (app capabilities, schema, architecture). Resolve decision tickets with `/grill-with-docs` (updates `GLOSSARY.md` and `docs/adr/` inline).
2. `/to-spec` per vertical slice.
3. `/to-tickets` per spec, labelled `ready-for-agent` or `ready-for-human`.
4. Implement by hand (Claude Code or Cursor) or AFK via `npm run sandcastle -- --provider claude|cursor`.

## Decided

- **Stack:** Next.js (App Router) + TypeScript + Tailwind, Supabase Postgres, Vercel, Vitest.
- **Deterministic parser, no LLM** in the import path. It's faithful and testable, and avoids invented or dropped content. Explain this in the video (brief section "Use AI tools").
- **Improvement:** the **Import Trust Report** (see `hive-importer-findings.md` for the evidence). Hive already matches counts; the gap is proof and transparency.
- **Issue tracker:** GitHub Issues on `vidhatatrivedy/hive-template-importer`, default triage labels.
- **Primary fixture and live-app seed:** `InterNACHI Residential -2026-09-30.xls`. Ben Gromicko is the stress test; Radon demonstrates what's missing from the export.
- **Order truth:** row position in the file, not the `Order` column.
- **Duplicates are preserved**, and flagged as a notice.

## Proposed (to settle in grilling)

### Capabilities

- Upload → parse → **preview Trust Report before committing?** (or commit, then report). The template name is editable at upload, prefilled from the filename with the `-YYYY-MM-DD` suffix stripped.
- Template list; template view in Spectora-like order, comments **grouped by type** for display.
- Edit: section, item and comment names, and comment text (the baseline). Stretch: reorder, add/delete, edit options and defaults.
- Duplicate a template, with deep-copy independence.
- Trust Report: decided in [Import issue taxonomy and Trust Report contents](https://github.com/vidhatatrivedy/hive-template-importer/issues/11): severity `warning`/`notice` × class Changed/Unsupported/Missing from export/Check; Summary, per-Section reconciliation recomputed from stored Version 1, issues grouped by kind, External assets, Kept but not used, Missing from export; a per-Comment Source row view; imported Templates only.
- Failure cases with specific messages:
  - plain-text export or random file
  - missing or renamed columns
  - empty sheet
  - bad cell values (unknown comment or answer type)
  - oversized file
- Auth: none, or a single demo login? Must be low friction for reviewers.

### Technical

- **Schema:** decided in [Schema](https://github.com/vidhatatrivedy/hive-template-importer/issues/12) and [ADR 0002](adr/0002-each-version-owns-a-normalised-row-tree.md): fully normalised, Template → Version → Section → Item → Comment, each Version owns its rows; raw rows, issues and cuts belong to the Import run. The table list is in the ticket's resolution.
- **Parsing library:** decided in [Architecture](https://github.com/vidhatatrivedy/hive-template-importer/issues/13): read-excel-file with `{trim:false}`; empty and absent cells are both `null`.
- **Architecture:** decided in [Architecture](https://github.com/vidhatatrivedy/hive-template-importer/issues/13): pure `src/core`, one `src/db` adapter, Server Actions in `src/app`; Import re-parses on commit.
- **HTML handling:** decided in [Rich content policy for comment HTML](https://github.com/vidhatatrivedy/hive-template-importer/issues/10) and [ADR 0001](adr/0001-sanitise-comment-html-by-cutting-source-spans.md): store sanitised HTML beside the unchanged source cell; a custom parse5 pass cuts only disallowed spans and logs every cut. Name decoding and trimming: *Import normalisation policy*.
- **Atomic writes:** decided in [ADR 0003](adr/0003-all-database-access-through-postgres-functions.md): every write and read is one Postgres function called by the server with the service-role key.
- **Preservation proof:** decided in [Verification strategy](https://github.com/vidhatatrivedy/hive-template-importer/issues/14): a round-trip over all six fixtures that fails on any Unexplained difference, in pure Vitest and again through the database; edit persistence, Copy independence and Version restore against the hosted dev project (`npm run test:db`); `npm run verify` prints the per-fixture table.
- **Assets:** keep external URLs, listed in the Trust Report. Copying into Supabase Storage is out of scope.

## Open questions

All resolved by the wayfinder map; the answers are consolidated in [`docs/spec/`](spec/functional.md).

- Is the Trust Report shown *before* the import is committed (review → confirm), or after?
- How far does the editor go beyond names and text (options, defaults, reorder, add/delete)?
- Are answer types editable, or read-only metadata?
- Auth model for the live app.
- Split runs: how do we treat an item name that reappears non-contiguously in a section? (No fixture has one; decide the policy and the Import issue.)
- `Default Value` `f` vs `false`: normalise, or store raw plus a normalised value?
- Mirror Spectora's type-grouped display, or show file order?

## To do outside the code

- [ ] Supabase dev project: fill `.env.local` (template `.env.example`), and the Supabase block of `.sandcastle/.env`.
- [ ] Vercel project linked to the repo.
- [ ] `.sandcastle/.env` (Claude token, Cursor key, GitHub token), then update Docker Desktop (installed version is 20.10 from 2022), start it, and run `npx sandcastle docker build-image`.
- [ ] Verify the Cursor model id: `cursor-agent --list-models` (default assumed `grok-4.7[effort=high]`).
- [ ] Hive: open "We'll Buy Your Home Back" in `</>` code view to confirm whether the iframes are stored-but-hidden or dropped.
- [ ] Hive: import, reload without saving, and check it persisted (the "unsaved changes" banner question).
- [ ] Hive: finish a sample inspection and publish a report (required by the brief).
- [ ] Optional: Binsr trial, and compare its template import with Hive's.

## Deliverables checklist (from `docs/brief.md`)

- [ ] Repo with meaningful history, fixtures, README (setup, DB init, env vars)
- [ ] NOTES.md (cuts, supported input and limitations, how it was checked, time spent, credits)
- [ ] Live URL seeded with InterNACHI Residential
- [ ] 8-10 min video
- [ ] Reply to Apoorv with repo, URL, video link
