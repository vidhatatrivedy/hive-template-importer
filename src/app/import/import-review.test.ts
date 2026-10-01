import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { ImportDraft } from "@/core/import/schemas";
import { toImportReview } from "@/app/import/import-review";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

// Rows, Sections and Items from fixtures/spectora/README.md. Every row is one Comment.
const HTML_FIXTURES = [
  ["InterNACHI Residential -2026-09-30.xls", 392, 13, 69],
  ["Residential Template-2026-09-30.xls", 395, 13, 70],
  ["InterNACHI Commercial Template-2026-09-30.xls", 406, 15, 67],
  ["Room-by-Room Residential Template-2026-09-30.xls", 798, 22, 136],
  ["Ben Gromicko's Template for Home Inspections-2026-09-30.xls", 1248, 17, 133],
  ["Radon Inspection-2026-09-30.xls", 10, 2, 3],
] as const;

describe("toImportReview", () => {
  it.each(HTML_FIXTURES)("summarises %s as the fixtures README counts it", async (file, rows, sections, items) => {
    const draft = await draftOf(file);
    const review = toImportReview(draft);

    expect(review.counts).toEqual({ rowsRead: rows, blankRows: 0, sections, items, comments: rows });
    expect(review.issueCounts.warning + review.issueCounts.notice).toBe(draft.issues.length);
    expect(review).toMatchObject({
      filename: file,
      byteSize: draft.run.byteSize,
      sha256: draft.run.sha256,
      suggestedName: draft.suggestedName,
      previousImport: null,
    });
  });

  it("counts InterNACHI Residential's issues by severity", async () => {
    const review = toImportReview(await draftOf("InterNACHI Residential -2026-09-30.xls"));
    expect(review.issueCounts).toEqual({ warning: 1, notice: 13 });
  });

  it("suggests the filename without its extension and export date", async () => {
    const review = toImportReview(await draftOf("InterNACHI Residential -2026-09-30.xls"));
    expect(review.suggestedName).toBe("InterNACHI Residential");
  });

  it("returns counts only, never the draft's Source rows or tree", async () => {
    const review = toImportReview(await draftOf("Radon Inspection-2026-09-30.xls"));
    expect(Object.keys(review).sort()).toEqual(
      ["byteSize", "counts", "filename", "issueCounts", "previousImport", "sha256", "suggestedName"].sort(),
    );
  });
});

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
