import fs from "node:fs";
import path from "node:path";
import { readSheet } from "read-excel-file/node";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

export type FixtureCell = { fixture: string; row: number; text: string };

/** Every HTML fixture file (the plain-text export is excluded), read-only. */
export function htmlFixtureFiles(): string[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".xls") && !f.includes("(plain text)"))
    .sort();
}

/** Every non-empty Comment Text cell of one fixture, exactly as stored (no trimming). */
export async function commentTexts(fixture: string): Promise<FixtureCell[]> {
  const rows = await readSheet(fs.readFileSync(path.join(FIXTURE_DIR, fixture)), { trim: false });
  const column = rows[0].findIndex((h) => String(h).trim().toLowerCase() === "comment text");
  if (column < 0) throw new Error(`${fixture}: no Comment Text column`);
  const cells: FixtureCell[] = [];
  rows.slice(1).forEach((cells_, i) => {
    const value = cells_[column];
    if (typeof value === "string" && value !== "") cells.push({ fixture, row: i + 2, text: value });
  });
  return cells;
}

export async function allCommentTexts(): Promise<FixtureCell[]> {
  return (await Promise.all(htmlFixtureFiles().map(commentTexts))).flat();
}
