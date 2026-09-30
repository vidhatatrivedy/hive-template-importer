# Coding Standards

Loaded by the reviewer agent. Project context is in `AGENTS.md`; vocabulary in `GLOSSARY.md`.

## Fidelity rules (highest priority)

- The importer never silently drops, merges, reorders or rewrites customer content. Anything skipped or changed produces an Import issue that names the Source row.
- Row order in the Spectora export is the canonical order. Never sort by the `Order (w/i item)` column or alphabetically.
- Keep the original raw row for every stored Comment, so a Copy or edit can always be traced back.
- Duplicates are kept, not deduplicated.

## Style

- TypeScript strict; no `any`, no non-null `!` on data from files or the database. Validate external input with zod at the boundary.
- Named exports. Domain terms from `GLOSSARY.md` in identifiers (`Item`, not `Subsection`).
- Parsing and mapping logic is pure and framework-free (no Next.js or Supabase imports), so it can be tested directly against fixtures.
- Database writes for one import or one copy happen in a single transaction.

## Testing

- Behaviour is tested through public interfaces against the real files in `fixtures/spectora/`, not hand-built mocks, wherever practical.
- Every Import issue kind has a test that triggers it.
- Preservation is checked by round-trip: parse → store shape → export back to rows → compare with the source.
