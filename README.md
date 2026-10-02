# Hive Template Importer

Import a Spectora template export, edit it, duplicate it, and see proof that nothing was lost. Built as a take-home for Hive Inspect; scope and requirements are in [`docs/brief.md`](docs/brief.md). Cuts, limitations and how it was checked are in [`NOTES.md`](NOTES.md).

## What it does

- **Import** a Spectora **"Export HTML Text"** spreadsheet (`.xls`, really an xlsx). The file is parsed by deterministic code, reviewed (name, counts, issue counts), then stored in one transaction as a structured Template: Sections → Items → Comments, in file order. Nothing is stored until you press Import.
- **Reject** what it can't import faithfully, with a reason: the Plain-text export, non-xlsx files, files over 4 MB, missing required columns, empty or corrupt workbooks.
- **Prove it** with the **Import Trust Report**: every Source row is checked against the stored Version 1 (✓/✗ and a verdict such as "392 / 392 rows verified"), with every Import issue grouped and filterable, External assets, columns kept but not used, and what Spectora leaves out of the export. Each imported Comment links to its Source row: raw → stored, with every sanitiser cut highlighted.
- **Edit** in a Spectora-style column editor (Sections │ Items │ Comments │ detail). One Save makes one Version; old Versions open read-only and can be restored. Stale Saves are refused, never overwritten.
- **Duplicate, Rename, Delete**, and create **Blank** Templates.

Vocabulary (Template, Version, Source row, Import issue, …) is defined in [`GLOSSARY.md`](GLOSSARY.md).

## Stack

Next.js 16 (App Router, `src/`), TypeScript, Tailwind 4, Supabase Postgres, Vercel. Vitest for tests. All database access goes through Postgres functions called with the server-only secret key ([ADR 0003](docs/adr/0003-all-database-access-through-postgres-functions.md)); the browser never talks to Supabase.

## Local setup

Requires Node 22 and npm.

```bash
npm install
cp .env.example .env.local      # fill in the dev Supabase project's values
SUPABASE_DB_URL='postgresql://…' npm run db:push   # or put it in your shell env
npm run seed                    # wipes the database and imports InterNACHI Residential
npm run dev                     # http://localhost:3000
```

`npm run seed` prints the database host and asks you to type it before wiping anything.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL` | app, seed, test:db | Project URL (Project Settings → API) |
| `SUPABASE_SECRET_KEY` | app, seed, test:db | Server-only secret key (`sb_secret_…`). Never exposed to the browser |
| `SUPABASE_DB_URL` | `db:push`, `db:reset`, test:db | Postgres connection string: **Session pooler**, port 5432, password URL-encoded. Dev only |
| `SUPABASE_PUBLISHABLE_KEY` | test:db | Only for test:db's grants check. Dev only; the app never reads it |

There are two Supabase projects. `.env.local` points at **dev**, which is disposable: `test:db` resets it. `.env.prod` holds only the **prod** project's `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. All `.env*` files except `.env.example` are gitignored.

## Database

Schema, functions and grants live in [`supabase/migrations/`](supabase/migrations/) and contain no data. The Supabase CLI is a pinned dev dependency, driven by a connection string (no `supabase login` or local stack).

| Command | Does |
|---|---|
| `npm run db:push` | Applies pending migrations to `$SUPABASE_DB_URL` |
| `npm run db:reset` | Drops everything at `$SUPABASE_DB_URL` and re-applies every migration |
| `npm run seed` | Wipes the database in `.env.local` and imports InterNACHI Residential as the only Template, then verifies it |
| `npm run seed -- --env-file .env.prod` | The same against prod |

## Checks

| Command | Does |
|---|---|
| `npm run typecheck` | `next typegen` + `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Offline unit and fixture tests: counts, round-trip, quirks, rejections, sanitiser, editor reducer |
| `npm run verify` | Imports every fixture in memory and prints a per-file table; **unexplained** must be 0 |
| `npm run test:db` | Database tests against the **dev** project. Resets it first, so re-seed afterwards. One run at a time |
| `npm run samples` | Writes demo and edge-case workbooks to `samples/` (gitignored) |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test and verify on every push.

`npm run verify` on the fixtures:

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

## Deploying (Vercel + Supabase)

1. Create a **prod** Supabase project (region `us-east-1`, next to the Vercel functions in `iad1`, set in [`vercel.json`](vercel.json)).
2. Apply the migrations with prod's Session pooler connection string:
   ```bash
   SUPABASE_DB_URL='postgresql://…prod…' npm run db:push
   ```
3. Put prod's `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.prod`, then seed it:
   ```bash
   npm run seed -- --env-file .env.prod
   ```
4. Import the GitHub repo in Vercel (framework preset Next.js, default build settings) and set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for Production. Pushes to `main` deploy.

Uploads are capped at 4 MB, which fits inside Vercel's 4.5 MB request body limit.

## Test input

Real Spectora exports live in [`fixtures/spectora/`](fixtures/spectora/), with a README on where each came from and its quirks. The primary one is `InterNACHI Residential -2026-09-30.xls`. Fixtures are never edited; new cases get new files.

## Docs

- [`docs/brief.md`](docs/brief.md): the assignment.
- [`docs/spec/`](docs/spec/): functional, technical and design spec.
- [`docs/adr/`](docs/adr/): decisions (sanitising by cutting source spans, one row tree per Version, database access through Postgres functions).
- [`docs/research/`](docs/research/): the export format, how Hive's importer behaves, xlsx readers, Supabase limits, the HTML in the fixtures.

## How this repo is developed

Worked on by both Claude Code and Cursor, using provider-neutral agent setup:

- **`AGENTS.md`**: shared agent context (`CLAUDE.md` just imports it).
- **Skills** from [mattpocock/skills](https://github.com/mattpocock/skills) in `.agents/skills/` (symlinked into `.claude/skills/`).
- **[Sandcastle](https://github.com/mattpocock/sandcastle)** in `.sandcastle/`: an implement → review agent loop over GitHub issues labelled `ready-for-agent`, run in Docker, with the provider chosen per run:

```bash
cp .sandcastle/.env.example .sandcastle/.env    # add CLAUDE_CODE_OAUTH_TOKEN / CURSOR_API_KEY / GH_TOKEN
npx sandcastle docker build-image               # once (Docker must be running)
npm run sandcastle -- --provider claude         # claude-opus-5-5, effort medium
npm run sandcastle -- --provider cursor         # grok-4.7, effort high
npm run sandcastle -- --help
```
