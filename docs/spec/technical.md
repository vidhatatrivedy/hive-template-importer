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
  - The Import issue catalogue: kind → severity, class and message. See [taxonomy][t11].
  - `buildTrustReport(run, version1, issues, cuts)` and the shared **reconciliation** function.
  - `toExportRows(tree, sourceRows)`.
  - The zod editable-tree schema.
- **`src/db/`** is the one Supabase adapter: typed RPC wrappers that validate every result against core's zod types. It has no repository interface and no fake.
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
import_issues  (id, import_run_id → import_runs, source_row_id null, severity, class, kind, detail jsonb)
html_cuts      (id, import_issue_id → import_issues, start, end, kind, removed_text, replacement null)
```

The complete rules are in [Schema][t12]. The ones that drive implementation:
- **Ids and positions:** ids are uuids and change on every Save. Positions are contiguous from 0, with `unique(parent, position)`. Comments are stored in file order across all types.
- **Constraints:** vocabularies are `text` with a `check`. Category is `smallint` in (-1, 0, 1). Names are non-blank by check. A check ties each Version `origin` to its columns.
- **Raw evidence:** raw-only columns live only in `source_rows.cells`, aligned to `import_runs.headers`. Import issue messages aren't stored; they're rendered from `kind` + `detail`. Sanitiser cuts are stored, and each belongs to one issue.
- **Computed, never stored:** Version counts, the latest Version, the last-saved sort and creation kind.
- **Immutability:** a trigger refuses UPDATE on everything except `templates.name`.
- **Concurrent Save:** inserting `base + 1` hits `unique(template_id, number)`.
- **Lifetimes:**
  - Deleting a Template cascades to its content.
  - `templates.import_run_id` is inherited by Copies, including a Copy of a Copy.
  - An Import run is deleted only when nothing references it.

  These supersede "deep-copy Source rows" in [Editor][t7] and "Import run deleted with its Template" in [Import flow][t6].

## Database access ([Architecture][t13], [ADR 0003](../adr/0003-all-database-access-through-postgres-functions.md))

- Every read and write is one plpgsql function, called with one `.rpc()` from server code using the **service-role key**.
- **Writes**, one transaction each:
  - `import_template(jsonb)`
  - `save_version(template_id, base_number, tree jsonb)`
  - `duplicate_template(template_id)` and `restore_version(version_id, base_number)`, both `INSERT … SELECT` inside the database
  - `rename_template`
  - `delete_template`, which also cleans up orphaned Import runs
  - `wipe_all`, used by Seed only
- **Reads** each return one `jsonb` value, which avoids the 1,000-row cap:
  - `get_version_tree(version_id)`
  - `get_import_evidence(import_run_id)`
  - `list_templates()`
- **Grants:** RLS is on for every table, with no policies. `execute` is revoked from `public`, `anon` and `authenticated`, and granted to `service_role`. The browser never holds a Supabase client. The env vars are `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only.
- **Save:** the action validates the tree with zod, trims names and re-sanitises every Comment; the server's result is what's stored. The RPC checks that every `source_row_id` belongs to the Template's `import_run_id`. Edit-time cuts are never stored.

## Next.js surface ([Architecture][t13])

- **Mutations** are Server Actions only: preview import, commit import, Save, Duplicate, Restore, Rename and Delete. `serverActions.bodySizeLimit` is `'4.5mb'`, and the action enforces the 4 MB cap itself. **Reads** happen in Server Components. There are no route handlers.
- **Import review → commit** is stateless. Preview returns only the summary. Commit re-sends the same file with the chosen name, the server re-parses it, checks the SHA-256 matches, and writes.
- **Errors:** expected failures return `{ ok: false, error: { kind, … } }`. The kinds are the six file rejections, a hash mismatch, Save validation, a stale base Version and Template not found. Messages come from core, never from Postgres. Unexpected errors throw to `error.tsx`.
- **Editor state:** one Client Component using `useReducer`, with temporary `tmp-…` ids, a dirty flag and a `beforeunload` guard. There's no client cache library and no optimistic updates. After a write, `refresh()` or `redirect()` reloads the page, and the reducer resets from it.
- **URLs:**
  - `/`: redirects to the last-saved Template, or shows the empty state
  - `/t/[templateId]`: the editor on the latest Version
  - `/t/[templateId]/v/[number]`: a read-only Version
  - `/import`: upload and Import review
  - `?pane=trust|versions` opens a pane, and `?pane=trust&row=<n>` opens a Source row view. These survive Saves.

## Migrations, environments, Seed ([Architecture][t13])

- `supabase/migrations/*.sql` holds the tables, trigger, functions and grants. `supabase db push` applies them, and `supabase gen types typescript` writes `src/db/database.types.ts`. There's no local stack.
- `npm run seed` runs `scripts/seed.ts` (tsx), with `--env-file .env.prod` for production. It prints the host and asks for a typed confirmation unless `--yes` is passed. It then runs `wipe_all()`, imports InterNACHI Residential through the real import path, reads Version 1 back and fails loudly on any **Unexplained difference**.

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

  Editor-reducer tests are here too.
- **`npm run test:db`** runs against the hosted dev project, using self-cleaning `test:` Templates and never `wipe_all`. Checks 8-13:
  8. DB round-trip.
  9. Edit persistence.
  10. Copy independence.
  11. Restore.
  12. Refusals: a stale base, a foreign `source_row_id`, and an UPDATE caught by the trigger.
  13. Orphan-run cleanup (cut first if short on time).
- **Synthetic workbooks** are built with `write-excel-file`, and one Excel-resaved fixture is added. Existing fixtures are never edited.
- There's no Playwright; UI flows are checked by hand against a checklist.
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
