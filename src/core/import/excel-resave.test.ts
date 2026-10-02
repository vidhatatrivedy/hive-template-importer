import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { ImportDraft } from "@/core/import/schemas";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

/** A human re-saves the HTML export in Excel so cells are shared strings. Agents must not create this file. */
const EXCEL_RESAVE = "InterNACHI Residential -2026-09-30 (excel).xls";
const ORIGINAL = "InterNACHI Residential -2026-09-30.xls";

function comparable(draft: ImportDraft) {
  return {
    sheetName: draft.run.sheetName,
    headers: draft.run.headers,
    rowsRead: draft.run.rowsRead,
    blankRows: draft.run.blankRows,
    valuesDecoded: draft.run.valuesDecoded,
    sourceRows: draft.sourceRows,
    issues: draft.issues,
    tree: draft.tree,
  };
}

describe("Excel re-save", () => {
  // Skipped until a human adds the file named above. Shared strings are a cell type the real fixtures never use.
  const present = fs.existsSync(path.join(FIXTURE_DIR, EXCEL_RESAVE));

  it.skipIf(!present)("parses the Excel re-save to the same draft as the original", async () => {
    const originalBytes = new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, ORIGINAL)));
    const excelBytes = new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, EXCEL_RESAVE)));
    const original = await parseSpectoraExport(originalBytes, ORIGINAL);
    const excel = await parseSpectoraExport(excelBytes, EXCEL_RESAVE);
    expect(original.ok).toBe(true);
    expect(excel.ok).toBe(true);
    if (!original.ok || !excel.ok) return;
    expect(comparable(excel.draft)).toEqual(comparable(original.draft));
  });
});
