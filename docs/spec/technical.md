# Technical spec

Schema, architecture and verification, for `/to-spec`. Each rule here is a short summary, and the linked ticket or ADR is where the full decision lives. If this file and a ticket disagree, the ticket wins and this file needs fixing.

Companion specs: [functional](functional.md) and [design](design.md). Research behind the choices:
- [xlsx readers][r2]
- [Supabase writes and upload limits][r3]
- [HTML in the fixtures][r4]
- [`spectora-export-format.md`](../research/spectora-export-format.md)

## Stack

Next.js (App Router, `src/`), TypeScript, Tailwind, Supabase Postgres (hosted **dev** and **prod** projects), Vercel, and Vitest. Import is deterministic code; there's no LLM. [`docs/plan.md`](../plan.md)

## Module seams ([Architecture][t13])

Dependencies point inward only.

- **`src/core/`** is pure: no Next.js, Supabase or React. It holds:
  - `parseSpectoraExport(bytes, filename) → Rejected | ImportDraft`: run metadata, Source rows, tree, issues and cuts.
  - `sanitiseCommentHtml(html) → { html, cuts }`: a custom parse5 span-cutting pass, also used in the browser preview. See [ADR 0001](../adr/0001-sanitise-comment-html-by-cutting-source-spans.md) and [Rich content][t10] for the allowlist.
  - The Import issue catalogue: kind → severity, class and message (29 kinds). See [taxonomy][t11] and the [slice 2 spec][s2]. Beside it, the rejection messages plus two import error messages, `hash-mismatch` and `name-blank`, and the exported `MAX_UPLOAD_BYTES`. These are importable in the browser without pulling in the parser. [slice 4 spec][s4]
  - `buildTrustReport(evidence, version1)` and the shared **reconciliation** function. The evidence is the Import run with its Source rows and its issues (each carrying its cuts), the shape `get_import_evidence` returns. [slice 2 spec][s2]
  - `toExportRows(tree, evidence)`, with cells aligned to the run's headers.
  - The zod editable-tree schema. A tree Comment names its Source row by row number (`sourceRow`), not by `source_row_id`; `src/db` maps between the two.
  - `prepareSave(tree)`: strips ids, trims names, Recommendation, option entries and free-text defaults, reports blank names, and re-sanitises every Comment, returning the text changes. The editor reducer uses it for the pre-Save notice and the Save action for what's stored. `summariseCuts(cuts)` words a cut list. The Save and Restore error messages sit beside the import error messages. [slice 5 spec][s5]
- **`src/db/`** is the one Supabase adapter: `createDb({ url, serviceRoleKey })` returns one typed wrapper per database function. Every result is validated against core's zod types (`EditableTree`, `ImportEvidence`) or `src/db`'s own (`TemplateSummary`, `TemplateDetail`). Expected refusals come back as `{ ok: false, error: { kind, … } }` with no message text; anything else throws. The wrappers hold no business logic: they don't trim, sanitise or validate the tree they're given, and only fill in each issue's severity and class from core's catalogue. There's no repository interface and no fake. [slice 3 spec][s3]
- **`src/app/`** holds routes, Server Components, Server Actions and the client editor state.
- xlsx reading uses **read-excel-file 9.3.10** with `{trim:false}`. Empty and absent cells are both `null`.

## Schema ([Schema][t12], [ADR 0002](../adr/0002-each-version-owns-a-normalised-row-tree.md))

The schema is fully normalised: Template → Version → Section → Item → Comment. Each Version owns a complete row tree, and there's no live tree. The latest Version is the saved content.

```
templates      (id uuid, name, created_at, import_run_id → import_runs null)
versions       (id, template_id → templates CASCADE, number, created_at, origin,
                source_version_id → versions SET NULL, source_template_name, source_version_number,
                restored_from_version_id → versions)          unique(template_id, number)
sections       (id, version_id → versions CASCADE, position, name)
items          (id, section_id → sections CASCADE, position, name)
comments       (id, item_id → items CASCADE, position, source_row_id → source_rows RESTRICT null,
                name, text_html not null default '', comment_type, category null, recommendation null,
                answer_type, default_boolean null, default_text null)
comment_options(comment_id → comments CASCADE, list ['choice'|'unit'], position, value)
import_runs    (id, filename, sha256, byte_size, sheet_name, headers text[],
                rows_read, blank_rows, values_decoded, created_at)
source_rows    (id, import_run_id → import_runs, row_number, cells jsonb)   unique(import_run_id, row_number)
import_issues  (id, import_run_id → import_runs, position, source_row_id null, severity, class, kind, detail jsonb)
html_cuts      (id, import_issue_id → import_issues, position, start, end, kind, removed_text, replacement null)
```

The complete rules are in [Schema][t12]. The ones that drive implementation:
- **Ids and positions:** ids are uuids and change on every Save. Positions are contiguous from 0, with `unique(parent, position)`. Comments are stored in file order across all types.
- **Constraints:**
  - Vocabularies are `text` with a named `check (col = any (array[…]))`: issue kind (29), severity, class, cut kind, Comment type, Answer type, Version origin and option list. An offline test compares each with the array core (or `src/db`, for origin) exports. [slice 3 spec][s3]
  - Category is `smallint` in (-1, 0, 1).
  - Names are `not null` and `btrim(name) <> ''`. The database never trims; callers do.
  - A check ties each Version `origin` to its columns: `copy` needs the source name and number (`source_version_id` may be null once the source is deleted), `restore` needs `restored_from_version_id`, the others need all four null. `number = 1` exactly when origin is `import`, `blank` or `copy`.
- **Raw evidence:** raw-only columns live only in `source_rows.cells`, aligned to `import_runs.headers`. Import issue messages aren't stored; they're rendered from `kind` + `detail`. Severity and class are stored for counting in SQL, filled by `src/db` from the catalogue, and never returned in the evidence. Sanitiser cuts are stored, and each belongs to one issue.
- **Issue and cut order:** `import_issues.position` and `html_cuts.position` keep the draft's array order (`unique(parent, position)`), so the evidence reads back exactly as written. [slice 3 spec][s3]
- **Text is stored byte for byte:** names, `text_html`, options, headers and cells are never trimmed or normalised by the database.
- **Computed, never stored:** Version counts, the latest Version, the last-saved sort and creation kind.
- **Immutability:** a trigger refuses UPDATE on every table, except a `templates` UPDATE that changes only `name`, and a `versions` UPDATE that only sets `source_version_id` to null (the `SET NULL` fired when a Copy's source is deleted). DELETE stays allowed.
- **Concurrent Save:** inserting `base + 1` hits `unique(template_id, number)`.
- **Foreign keys:** references from content into evidence are `RESTRICT` (`templates.import_run_id`, `comments.source_row_id`). Keys inside the evidence have no delete action; the functions that delete evidence delete children first.
- **Lifetimes:**
  - Deleting a Template cascades to its content.
  - `templates.import_run_id` is inherited by Copies, including a Copy of a Copy.
  - An Import run is deleted only when no Template and no Comment references it.

  These supersede "deep-copy Source rows" in [Editor][t7] and "Import run deleted with its Template" in [Import flow][t6].

## Database access ([Architecture][t13], [ADR 0003](../adr/0003-all-database-access-through-postgres-functions.md))

- Every read and write is one plpgsql function, called with one `.rpc()` from server code using the **service-role key**. Functions are `security invoker` with `set search_path = ''`. Inserts are set-based (`jsonb_array_elements … WITH ORDINALITY`), never a row-at-a-time loop.
- **The functions speak core's JSON shapes verbatim** (camelCase), so `src/db` does no reshaping. Tree Comments and issues name Source rows by row number; every function maps row numbers to and from `source_row_id` in SQL, keeping each operation one round trip. [slice 3 spec][s3]
- **Writes**, one transaction each:

  | Function | Returns | Refusals |
  |---|---|---|
  | `import_template(payload jsonb)`, payload `{ name, evidence, tree }` | `{ templateId, versionId, importRunId }` | none |
  | `create_blank_template(name)` | `{ templateId, versionId }` | none |
  | `save_version(template_id, base_number, tree jsonb)` | `{ versionId, number }` | `template-not-found`, `stale-base`, `foreign-source-row` |
  | `restore_version(version_id, base_number)` | `{ versionId, number }` | `template-not-found`, `stale-base` |
  | `duplicate_template(template_id)` | `{ templateId, versionId }` | `template-not-found` |
  | `rename_template(template_id, name)` | nothing | `template-not-found` |
  | `delete_template(template_id)` | `{ importRunDeleted }` | `template-not-found` |
  | `wipe_all()` | nothing | Seed only; no Server Action wraps it |

  - `import_template` writes the run, Source rows, Template, Version 1, tree, issues and cuts. A `sourceRow` that isn't one of the draft's Source rows is a core bug: it raises and rolls back.
  - `duplicate_template` and `restore_version` copy the tree with `INSERT … SELECT`, keeping every `source_row_id`. A Copy is named "<source name> (copy)" and inherits the source's `import_run_id`. Restoring the latest Version is allowed.
  - `delete_template` then deletes the Template's Import run if nothing references it any more.
- **Reads** each return one `jsonb` value, or null for an unknown id, which avoids the 1,000-row cap:
  - `list_templates()` → `TemplateSummary[]`: id, name, `creation` (the origin of Version 1), `copiedFromName`, `importRun` (id, filename, sha256, importedAt; inherited by Copies) and `latest` (id, number, savedAt). Sorted by last Save, newest first. It also serves the Import review's SHA-256 notice: the newest Template with `creation = 'import'` and a matching hash.
  - `get_template(template_id)` → `TemplateDetail`: the summary plus `copiedFrom` (templateId, null once the source is deleted; name; Version number), the run's `byteSize`, and every Version newest first with its origin, `restoredFromNumber` and counts.
  - `get_version_tree(version_id)` → `EditableTree`.
  - `get_import_evidence(import_run_id)` → `ImportEvidence`.
- **Grants:**
  - RLS is on for every table, with no policies, and every table privilege is revoked from `anon` and `authenticated`.
  - `execute` is revoked from `public`, `anon` and `authenticated` on every function, and granted to `service_role`. The migrations also alter the default privileges, because Supabase grants `execute` on new functions to `anon` and `authenticated` by default.
  - App code never calls `.from()`. The browser never holds a Supabase client. The app's env vars are `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only.
- **Save:** the action runs `prepareSave` (trim, blank-name check, re-sanitise every Comment), then validates the result with zod; the server's result is what's stored. Edit-time cuts are never stored. `save_version`:
  1. Locks the Template row, or refuses `template-not-found`.
  2. Refuses `stale-base` (with `latestNumber`) if `base_number` isn't the latest.
  3. Resolves every non-null `sourceRow` within the Template's `import_run_id`, and refuses `foreign-source-row` with any that don't resolve. On a Blank Template, every non-null `sourceRow` is refused.
  4. Inserts Version `base_number + 1` with new uuids.

  The unique violation remains the backstop for a race, mapped to `stale-base` with `latestNumber = base_number + 1`.
- **Refusals** are raised with a custom SQLSTATE per kind and a JSON detail. `src/db` maps them by code, never by message text. Their messages live in core's catalogue.

## Next.js surface ([Architecture][t13])

- **Mutations** are Server Actions only: preview import, commit import, Save, Duplicate, Restore, Rename and Delete. `bodySizeLimit` is `'4.5mb'` (under `experimental.serverActions` in Next.js 16.3), and the action enforces the 4 MB cap itself. The browser refuses a file over the cap before sending it. **Reads** happen in Server Components. There are no route handlers.
- **Import review → commit** is stateless. Preview returns only the summary. Commit re-sends the same file with the chosen name and the preview's SHA-256. The server re-parses it, refuses `hash-mismatch` if the hash differs, trims the name (refusing `name-blank`), calls `importTemplate`, and `redirect`s to `/t/<id>?pane=trust` outside any `try`. [slice 4 spec][s4]
- **Errors:** expected failures return `{ ok: false, error: { kind, … } }`. The kinds are the six file rejections, `hash-mismatch`, `name-blank`, Save validation, and `src/db`'s refusals: `stale-base`, `template-not-found` and `foreign-source-row` (a foreign Source row can only come from a bug, but the Save action still returns it rather than throwing). Messages come from core, never from Postgres. Unexpected errors throw to `error.tsx`, except a thrown Save or Restore: the client catches it as `save-failed` / `restore-failed`, so no failure unmounts the editor and loses edits. [slice 5 spec][s5]
- **Editor state:** one Client Component using `useReducer` over a pure editor reducer (the slice 5 test seam), with temporary `tmp-…` ids. There's no client cache library and no optimistic updates. After a write, `refresh()` (from `next/cache`, Server Actions only) or `redirect()` reloads the page. [slice 5 spec][s5]
  - Dirty is computed by value against the base Version's tree, with structural sharing so Ben stays fast. Undoing an edit by hand makes it clean.
  - The reducer adopts a new Version from the page only when clean, or when it's awaiting that Version after its own Save or Load latest. A newer Version that arrives while dirty is held, never adopted. On adopting, the selection carries over by index path.
  - The editor isn't keyed on search params, so pane toggles and `?row=` changes keep its state.
- **Unsaved guard:** a provider in the root layout that the editor reports its dirty state to. It adds `beforeunload` while dirty, and gives a `GuardedLink` (cancels a navigation to another pathname via `onNavigate` and asks first), a `confirmDiscard()` for buttons, and one in-app confirm dialog. Back and forward aren't guarded. [slice 5 spec][s5]
- **Editor page reads:** `getTemplate`, `getVersionTree`, and, for an imported Template or Copy, `getImportEvidence` (wrapped in React `cache()` and shared with the Trust Report) for the read-only fields that aren't in `EditableTree`. [slice 5 spec][s5]
- **URLs:**
  - `/`: redirects to the last-saved Template, or shows the empty state
  - `/t/[templateId]`: the editor on the latest Version
  - `/t/[templateId]/v/[number]`: a read-only Version. An unknown number is not-found, and the latest number redirects to `/t/[templateId]`.
  - `/import`: upload and Import review
  - `?pane=` is a comma-separated set (`trust`, `versions` or `trust,versions`), because both panes can be open at once. Unknown values are ignored.
  - `?row=<n>` names a Source row by row number. With `trust` open it shows that row's Source row view, and the editor selects the Comment carrying that row. It's the Trust Report → Comment link, because ids change on every Save. These survive Saves.
  - Only `parseTemplateView` and `templateHref` parse and build these params. [slice 4 spec][s4] `templateHref` takes an optional Version number for `/v/[number]` URLs. [slice 5 spec][s5]

## Migrations, environments, Seed ([Architecture][t13])

- `supabase/migrations/*.sql` holds the tables, trigger, functions and grants, with no seed data. The Supabase CLI is a pinned dev dependency: `npm run db:push` applies the migrations to the linked project, and `npm run db:types` writes `src/db/database.types.ts`, which is committed. There's no local stack.
- Two hosted projects: `.env.local` points at **dev** and `.env.prod` at **prod**. Prod is pushed the same way, linked to prod, before the first deploy.
- `npm run seed` runs `scripts/seed.ts` (tsx), with `--env-file .env.prod` for production. It:
  1. prints the host, and asks you to type it unless `--yes` is passed
  2. runs `wipe_all()`
  3. parses InterNACHI Residential and imports it under its suggested name through `src/db`
  4. reads Version 1 and the evidence back and runs `reconcile`, printing one line in the `verify` format

  It exits non-zero on a rejection, on any **Unexplained difference**, or if not every row is verified. It never re-implements reconciliation.

## Verification ([Verification][t14])

- **Round-trip property:** `toExportRows` from the stored tree must match the source with no Unexplained difference. It uses the same reconciliation function as the Trust Report.
- **`npm test`** is pure and offline, and runs in CI and sandcastle. Checks 1-7:
  1. Fixture counts, plus plain-text rejection.
  2. Round-trip on all six fixtures.
  3. Pinned quirks.
  4. The six file rejections.
  5. The sanitiser.
  6. Catalogue completeness.
  7. The zod schema.

  Editor-reducer tests, the `prepareSave` fixture law (no change on any fixture tree), a check that Ben's tree serialises to under 4 MB, and the offline vocabulary test (database `check` arrays vs core's) are here too. [slice 5 spec][s5]
- **`npm run test:db`** runs against the hosted dev project through the `src/db` wrappers, with a separate Vitest config that `npm test`, CI and sandcastle never pick up. [slice 3 spec][s3]
  - It loads `.env.local` only, prints the host, and takes no env-file flag, so it can't reach prod.
  - Its Templates are named `test:…`. It deletes its own afterwards, and any stale `test:` leftovers at start, through `deleteTemplate`. It never calls `wipe_all`.

  Checks 8-13:
  8. DB round-trip on all six fixtures: the evidence and the tree (ids removed) read back deep-equal to the draft's, and `reconcile` reports 0 unexplained. This is also the zod ↔ jsonb contract test and the live payload-size test on Ben.
  9. Edit persistence.
  10. Copy independence, both ways, including after the source is deleted.
  11. Restore.
  12. Refusals: a stale base (Save and Restore), a foreign Source row (including any on a Blank Template), unknown ids, and an UPDATE caught by the trigger. A Rename and deleting a source with a Copy still work.
  13. Orphan-run cleanup (cut first if short on time).

  A grants check runs only if `SUPABASE_ANON_KEY` is set in `.env.local`: the anon key must read nothing and call nothing. The app never reads that variable.
- **Synthetic workbooks** are built with `write-excel-file`, and one Excel-resaved fixture is added. Existing fixtures are never edited.
- There's no Playwright; UI flows are checked by hand against a checklist. UI slices put their testable decisions in pure view helpers with Vitest tests (slice 4: `toImportReview`, `resolveReportBase`, `cutSegments`, the URL helpers and the import-flow reducer; slice 5: the editor reducer, `versionLabel` and `readOnlyFields`). `npm run samples` writes the rejection and edge-case workbooks the checklist uses to a gitignored folder. [slice 4 spec][s4]
- **CI** (GitHub Actions) runs `typecheck`, `lint`, `npm test` and `npm run verify`.
- **Agent process:**
  - AFK agents get no database credentials. Tickets that touch `supabase/migrations` or `src/db` are `ready-for-human`, or the human runs `test:db` at review.
  - Core and database tickets are written test-first and name the checks above that they must make pass.

[t6]: https://github.com/vidhatatrivedy/hive-template-importer/issues/6
[t7]: https://github.com/vidhatatrivedy/hive-template-importer/issues/7
[t10]: https://github.com/vidhatatrivedy/hive-template-importer/issues/10
[t11]: https://github.com/vidhatatrivedy/hive-template-importer/issues/11
[t12]: https://github.com/vidhatatrivedy/hive-template-importer/issues/12
[t13]: https://github.com/vidhatatrivedy/hive-template-importer/issues/13
[t14]: https://github.com/vidhatatrivedy/hive-template-importer/issues/14
[r2]: https://github.com/vidhatatrivedy/hive-template-importer/issues/2
[r3]: https://github.com/vidhatatrivedy/hive-template-importer/issues/3
[r4]: https://github.com/vidhatatrivedy/hive-template-importer/issues/4
[s2]: https://github.com/vidhatatrivedy/hive-template-importer/issues/18
[s3]: https://github.com/vidhatatrivedy/hive-template-importer/issues/19
[s4]: https://github.com/vidhatatrivedy/hive-template-importer/issues/20
[s5]: https://github.com/vidhatatrivedy/hive-template-importer/issues/21
