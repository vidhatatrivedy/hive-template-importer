# Brief: Spectora template importer

Condensed from Hive Inspect's assignment PDF (Forward Deployed Engineer take-home). Submission deadline **2026-10-03** (per the recruiter email; the PDF's 21 September date is superseded).

## Customer

An inspection company leaving Spectora with a template tuned for four years. They will not retype it. **Preserving their work matters more than originality.**

## Working baseline (all required)

1. **Import.** Upload a Spectora HTML-text export (the spreadsheet, not the plain-text export). Preserve the template's text, hierarchy and ordering. Make skipped or unsupported content visible. Never quietly drop or rewrite it.
2. **Edit.** Change section names, item names and comment text after import, and save. How much further the editor goes is our call.
3. **Copy.** Duplicate a template. Editing the copy must leave the original unchanged.
4. **Store.** Templates, edits and copies persist in a real backend (Supabase), and survive closing and reopening the app. Browser storage alone is not enough.
5. **Model it.** Import into a schema we designed (templates, sections, items, comments, or similar). HTML inside a comment field is fine; a whole template stored as one HTML blob is not.

Also required:

- Explain the handling of formatting, links and rich content, with limits.
- Distinguish **information missing from the export** from **information our importer does not support**.
- Work beyond the committed file; they may try another export in the same format.
- Show how we checked preservation, saved edits and independent copies, plus at least one failure case.
- If a model is used for import mapping: show behaviour on malformed output, invented sections and dropped content. (We use a deterministic parser; the same honesty expectations apply.)

## Go further (pick one)

Chosen: **make the import easier to trust**, via an Import Trust Report: source vs stored reconciliation, visible warnings, and a per-row view of what was changed or skipped. See `docs/research/hive-importer-findings.md` for why.

## Out of scope

Writing inspection reports, scheduling, payments, homeowner-facing reports or portals, mobile.

## Deliverables

1. **Repo**: meaningful history, the committed Spectora export(s), a README (setup, DB init, env vars), no credentials. Include reusable prompts, skills and agent setups.
2. **Live URL** on Vercel, opening on an already-imported template; login instructions if any.
3. **NOTES.md**: what was cut and why, supported input and known limitations, how the work was checked, approximate time spent, credits for code built on.
4. **Walkthrough video**, 8-10 min (12 max), camera on for the intro: you; import on camera plus a saved edit plus an independent copy; the repo and AI tooling; the data model and preservation checks; decisions and cuts (Binsr comparison optional); the hardest import problem plus a failure case; direct feedback on Hive's product.
