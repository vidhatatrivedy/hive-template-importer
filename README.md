# Hive Template Importer

Import a Spectora template export, edit it, duplicate it, and see proof that nothing was lost. Built as a take-home for Hive Inspect; scope and requirements are in [`docs/brief.md`](docs/brief.md).

> Status: scaffolding. Setup, database initialisation and deployment instructions will be completed as the app is built.

## Setup

Requires Node 22 and npm.

```bash
npm install
cp .env.example .env.local   # fill in Supabase values
npm run dev
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` (server only) | Server-side writes |

## Test input

Real Spectora exports live in [`fixtures/spectora/`](fixtures/spectora/), along with a note on where each came from and its quirks. The primary one is `InterNACHI Residential -2026-09-30.xls`.

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
