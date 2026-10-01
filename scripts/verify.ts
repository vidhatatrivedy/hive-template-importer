import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { catalogue, countEditableTree, parseSpectoraExport, reconcile } from "../src/core/import";
import type { ImportDraft, ImportIssue } from "../src/core/import";
import type { IssueSeverity } from "../src/core/import/catalogue";

const FIXTURE_DIR = path.resolve("fixtures/spectora");

export type VerifyRow = {
  file: string;
  rowsRead: number;
  comments: number;
  sections: number;
  items: number;
  explained: number;
  unexplained: number;
  warnings: number;
  notices: number;
};

const COLUMNS: [string, (row: VerifyRow) => number][] = [
  ["rows", (row) => row.rowsRead],
  ["comments", (row) => row.comments],
  ["sections", (row) => row.sections],
  ["items", (row) => row.items],
  ["explained", (row) => row.explained],
  ["unexplained", (row) => row.unexplained],
  ["warnings", (row) => row.warnings],
  ["notices", (row) => row.notices],
];

export function summariseDraft(file: string, draft: ImportDraft): VerifyRow {
  const counts = countEditableTree(draft.tree);
  const result = reconcile(draft, draft.tree);
  return {
    file,
    rowsRead: draft.run.rowsRead,
    comments: counts.comments,
    sections: counts.sections,
    items: counts.items,
    explained: result.explained,
    unexplained: result.unexplained,
    warnings: countSeverity(draft.issues, "warning"),
    notices: countSeverity(draft.issues, "notice"),
  };
}

export function formatVerifyTable(rows: readonly VerifyRow[]): string {
  const fileWidth = Math.max("file".length, ...rows.map((row) => row.file.length));
  const widths = COLUMNS.map(([title]) => title.length);
  const line = (file: string, values: string[]) =>
    [file.padEnd(fileWidth), ...values.map((value, index) => value.padStart(widths[index] ?? 0))].join("  ");

  const lines = [line("file", COLUMNS.map(([title]) => title))];
  for (const row of rows) lines.push(line(row.file, COLUMNS.map(([, value]) => String(value(row)))));
  return lines.join("\n");
}

/** Non-zero when any accepted fixture has an Unexplained difference. */
export function verifyExitCode(rows: readonly VerifyRow[]): number {
  return rows.some((row) => row.unexplained > 0) ? 1 : 0;
}

function countSeverity(issues: readonly ImportIssue[], severity: IssueSeverity): number {
  let count = 0;
  for (const issue of issues) {
    const entry = catalogue.find((candidate) => candidate.kind === issue.kind);
    if (entry?.severity === severity) count += 1;
  }
  return count;
}

async function main() {
  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".xls"))
    .sort();

  const rows: VerifyRow[] = [];
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(FIXTURE_DIR, file));
    const result = await parseSpectoraExport(bytes, file);
    rows.push(summariseDraft(file, result.draft));
  }

  console.log(formatVerifyTable(rows));
  process.exitCode = verifyExitCode(rows);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
