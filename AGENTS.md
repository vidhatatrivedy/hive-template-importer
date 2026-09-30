<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hive Template Importer

Take-home for Hive Inspect (Forward Deployed Engineer). A desk-side web app that imports a **Spectora "HTML Text" template export**, stores it as a structured, editable template, lets the inspector edit and duplicate it, and proves nothing was lost. Due **2026-10-03**. Read `docs/brief.md` before planning any feature; it holds the requirements and grading priorities.

Priorities, in order: faithful import (text, hierarchy, order) → visible, honest handling of anything skipped or unsupported → a usable edit/copy workflow → the chosen improvement (Import Trust Report).

## Stack

Next.js (App Router, `src/`), TypeScript, Tailwind, Supabase Postgres, Vercel. Vitest for tests. Import parsing is deterministic code, not an LLM.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Tests | `npm test` |
| Lint | `npm run lint` |
| AFK agent loop | `npm run sandcastle -- --provider claude\|cursor` (see below) |

Run `npm run typecheck` and `npm test` before every commit.

## Where things are

- `docs/brief.md`: the assignment, condensed. Source of truth for scope.
- `docs/spec/`: the consolidated functional, technical and design spec (input for `/to-spec`). Start here when building.
- `docs/plan.md`: what's decided, what's proposed, open questions and to-dos. Start here when planning.
- `docs/research/`: verified findings. `spectora-export-format.md` (column-by-column reference), `hive-importer-findings.md` (how Hive's importer behaves), `product-models.md` (how Spectora and Hive structure templates in their UIs). Cite these instead of re-deriving.
- `fixtures/spectora/`: six real Spectora exports plus a README of their quirks. Tests import against these. Never edit them; add new fixtures instead.
- `GLOSSARY.md`, `docs/adr/`: domain vocabulary and decisions (see Agent skills below).
- `.sandcastle/`: sandboxed agent runner (implement → review loop over GitHub issues).
- `.agents/skills/`: shared skills (canonical copy, read by Cursor); `.claude/skills/` symlinks to them for Claude Code.

## Multi-agent, multi-provider rules

This repo is worked on by Claude Code and Cursor, switching mid-task. Keep it provider-neutral:

- Project knowledge goes in this file, `docs/`, `GLOSSARY.md` or ADRs. Never in a provider-only file (`.cursor/rules`, Claude memory, etc.). `CLAUDE.md` stays a one-line `@AGENTS.md` import.
- Skills live in `.agents/skills/`. Install or update with `npx skills@latest add mattpocock/skills -a claude-code -a cursor`, so both agents get them.
- Hand off with `/handoff` (writes a doc any agent can pick up) rather than relying on chat history.
- State of work lives in GitHub issues and commits, not in a session.

## Sandcastle (AFK agents)

`npm run sandcastle -- [options]` runs an implement → review loop in Docker over open issues labelled `ready-for-agent`.

- `--provider claude` (default): `claude-opus-5-5`, effort `medium`
- `--provider cursor`: `grok-4.7`, effort `high` (sent to Cursor as `grok-4.7[effort=high]`)
- `--model`, `--effort`, `--review-provider`, `--review-model`, `--review-effort`, `--iterations`, `--dry-run`, `--help`

Credentials live in `.sandcastle/.env` (template: `.sandcastle/.env.example`); every key there is injected into the sandbox, including the dev Supabase project's, so agents run `test:db` themselves. Needs Docker running and the image built once: `npx sandcastle docker build-image`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on `vidhatatrivedy/hive-template-importer`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
