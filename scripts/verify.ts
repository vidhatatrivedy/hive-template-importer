import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { catalogue, countEditableTree, parseSpectoraExport, reconcile } from "../src/core/import";
import type {
  EditableTree,
  ImportDraft,
  ImportIssue,
  ParseResult,
  ReconcileResult,
  RejectionKind,
} from "../src/core/import";
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
  /** Rejection kind, or null when the file was imported. */
  rejection: RejectionKind | null;
};

const COLUMNS: [string, (row: VerifyRow) => string | number][] = [
  ["rows", (row) => row.rowsRead],
  ["comments", (row) => row.comments],
  ["sections", (row) => row.sections],
  ["items", (row) => row.items],
  ["explained", (row) => row.explained],
  ["unexplained", (row) => row.unexplained],
  ["warnings", (row) => row.warnings],
  ["notices", (row) => row.notices],
  ["rejection", (row) => row.rejection ?? ""],
];

export function summariseDraft(file: string, draft: ImportDraft): VerifyRow {
  return summariseVerified({
    file,
    rowsRead: draft.run.rowsRead,
    tree: draft.tree,
    result: reconcile(draft, draft.tree),
    issues: draft.issues,
  });
}

/** One verify-format row for an accepted import, counted from the tree that was stored or parsed. */
export function summariseVerified(input: {
  file: string;
  rowsRead: number;
  tree: EditableTree;
  result: ReconcileResult;
  issues: readonly ImportIssue[];
}): VerifyRow {
  const counts = countEditableTree(input.tree);
  return {
    file: input.file,
    rowsRead: input.rowsRead,
    comments: counts.comments,
    sections: counts.sections,
    items: counts.items,
    explained: input.result.explained,
    unexplained: input.result.unexplained,
    warnings: countSeverity(input.issues, "warning"),
    notices: countSeverity(input.issues, "notice"),
    rejection: null,
  };
}

export function summariseParse(file: string, result: ParseResult): VerifyRow {
  if (result.ok) return summariseDraft(file, result.draft);
  return {
    file,
    rowsRead: 0,
    comments: 0,
    sections: 0,
    items: 0,
    explained: 0,
    unexplained: 0,
    warnings: 0,
    notices: 0,
    rejection: result.rejection.kind,
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

/**
 * Non-zero when an HTML fixture is rejected or has an Unexplained difference,
 * or when a plain-text fixture is not rejected as `plain-text-export`.
 */
export function verifyExitCode(rows: readonly VerifyRow[]): number {
  return rows.some((row) => !fixtureAccepted(row)) ? 1 : 0;
}

function fixtureAccepted(row: VerifyRow): boolean {
  if (row.file.includes("(plain text)")) return row.rejection === "plain-text-export";
  return row.rejection === null && row.unexplained === 0;
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
    rows.push(summariseParse(file, result));
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
