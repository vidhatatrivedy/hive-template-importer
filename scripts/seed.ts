import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { catalogue, countEditableTree, parseSpectoraExport, reconcile, rejectionMessage } from "../src/core/import";
import type { EditableTree, ImportEvidence, ImportIssue } from "../src/core/import";
import type { IssueSeverity } from "../src/core/import/catalogue";
import type { ReconcileResult } from "../src/core/import/reconcile";
import { createDb } from "../src/db";
import { formatVerifyTable, type VerifyRow } from "./verify";

const FIXTURE = "InterNACHI Residential -2026-09-30.xls";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.envFile);

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    process.exit(1);
  }

  const host = new URL(url).host;
  console.log(host);
  if (!args.yes && (await readTypedHost()) !== host) {
    console.error("Stopped. The database was not wiped.");
    process.exit(1);
  }

  const db = createDb({ url, serviceRoleKey });
  await db.wipeAll();

  const bytes = fs.readFileSync(path.resolve("fixtures/spectora", FIXTURE));
  const parsed = await parseSpectoraExport(bytes, FIXTURE);
  if (!parsed.ok) {
    console.error(rejectionMessage(parsed.rejection));
    process.exit(1);
  }

  const draft = parsed.draft;
  const imported = await db.importTemplate(draft, draft.suggestedName);
  const templates = await db.listTemplates();
  const detail = await db.getTemplate(imported.templateId);
  const version1 = detail?.versions.find((version) => version.number === 1);
  if (templates.length !== 1 || templates[0]?.name !== draft.suggestedName || !version1) {
    console.error(`Expected one Template named ${draft.suggestedName}.`);
    process.exit(1);
  }

  const [tree, evidence] = await Promise.all([
    db.getVersionTree(version1.id),
    db.getImportEvidence(imported.importRunId),
  ]);
  if (!tree || !evidence) {
    console.error("Version 1 or its evidence was not stored.");
    process.exit(1);
  }

  const result = reconcile(evidence, tree);
  console.log(formatVerifyTable([toVerifyRow(evidence, tree, result)]));
  if (result.unexplained > 0 || result.verified !== result.total) process.exit(1);
}

function parseArgs(argv: readonly string[]): { envFile: string | null; yes: boolean } {
  let envFile: string | null = null;
  let yes = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--yes") {
      yes = true;
    } else if (arg === "--env-file") {
      const next = argv[index + 1];
      if (!next) {
        console.error("--env-file needs a path");
        process.exit(1);
      }
      envFile = next;
      index += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return { envFile, yes };
}

/** Loads `.env.local`, or the file passed to `--env-file`. Absent `.env.local` keeps the process environment. */
function loadEnv(envFile: string | null) {
  const file = envFile ?? (fs.existsSync(".env.local") ? ".env.local" : null);
  if (!file) return;
  if (!fs.existsSync(file)) {
    console.error(`Env file not found: ${file}`);
    process.exit(1);
  }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readTypedHost(): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return rl.question("Type the host to wipe and re-import: ").finally(() => rl.close());
}

function toVerifyRow(evidence: ImportEvidence, tree: EditableTree, result: ReconcileResult): VerifyRow {
  const counts = countEditableTree(tree);
  return {
    file: evidence.run.filename,
    rowsRead: evidence.run.rowsRead,
    comments: counts.comments,
    sections: counts.sections,
    items: counts.items,
    explained: result.explained,
    unexplained: result.unexplained,
    warnings: countSeverity(evidence.issues, "warning"),
    notices: countSeverity(evidence.issues, "notice"),
    rejection: null,
  };
}

function countSeverity(issues: readonly ImportIssue[], severity: IssueSeverity): number {
  let count = 0;
  for (const issue of issues) {
    const entry = catalogue.find((candidate) => candidate.kind === issue.kind);
    if (entry?.severity === severity) count += 1;
  }
  return count;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
