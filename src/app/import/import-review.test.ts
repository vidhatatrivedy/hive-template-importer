import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { ImportDraft } from "@/core/import/schemas";
import type { TemplateSummary } from "@/db/schemas";
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
    const review = toImportReview(draft, []);

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
    const review = toImportReview(await draftOf("InterNACHI Residential -2026-09-30.xls"), []);
    expect(review.issueCounts).toEqual({ warning: 1, notice: 13 });
  });

  it("suggests the filename without its extension and export date", async () => {
    const review = toImportReview(await draftOf("InterNACHI Residential -2026-09-30.xls"), []);
    expect(review.suggestedName).toBe("InterNACHI Residential");
  });

  it("names the newest imported Template with this file's hash", async () => {
    const draft = await draftOf("Radon Inspection-2026-09-30.xls");
    const newest = summary({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Radon, second import",
      sha256: draft.run.sha256,
      importedAt: "2026-09-20T00:00:00.000Z",
    });
    const review = toImportReview(draft, [
      summary({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Radon, first import",
        sha256: draft.run.sha256,
        importedAt: "2026-09-01T00:00:00.000Z",
      }),
      newest,
      summary({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Radon, middle import",
        sha256: draft.run.sha256,
        importedAt: "2026-09-10T00:00:00.000Z",
      }),
    ]);

    expect(review.previousImport).toEqual({
      templateId: newest.id,
      name: "Radon, second import",
      importedAt: "2026-09-20T00:00:00.000Z",
    });
  });

  it("ignores Copies and other files, and is null when the list is empty", async () => {
    const draft = await draftOf("Radon Inspection-2026-09-30.xls");
    const copy = summary({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Copy of Radon",
      sha256: draft.run.sha256,
      importedAt: "2026-10-01T00:00:00.000Z",
      creation: "copy",
    });
    const otherFile = summary({
      id: "55555555-5555-4555-8555-555555555555",
      name: "Residential",
      sha256: "ab".repeat(32),
      importedAt: "2026-10-01T00:00:00.000Z",
    });

    const earlierImport = summary({
      id: "66666666-6666-4666-8666-666666666666",
      name: "Radon, kept",
      sha256: draft.run.sha256,
      importedAt: "2026-08-01T00:00:00.000Z",
    });

    expect(toImportReview(draft, []).previousImport).toBeNull();
    expect(toImportReview(draft, [copy, otherFile]).previousImport).toBeNull();
    expect(toImportReview(draft, [copy, otherFile, earlierImport]).previousImport).toEqual({
      templateId: earlierImport.id,
      name: "Radon, kept",
      importedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("returns counts only, never the draft's Source rows or tree", async () => {
    const review = toImportReview(await draftOf("Radon Inspection-2026-09-30.xls"), []);
    expect(Object.keys(review).sort()).toEqual(
      ["byteSize", "counts", "filename", "issueCounts", "previousImport", "sha256", "suggestedName"].sort(),
    );
  });
});

function summary(options: {
  id: string;
  name: string;
  sha256: string;
  importedAt: string;
  creation?: TemplateSummary["creation"];
}): TemplateSummary {
  const creation = options.creation ?? "import";
  return {
    id: options.id,
    name: options.name,
    creation,
    copiedFromName: creation === "copy" ? "Radon" : null,
    importRun: {
      id: options.id,
      filename: "file.xls",
      sha256: options.sha256,
      importedAt: options.importedAt,
    },
    latest: { id: options.id, number: 1, savedAt: options.importedAt },
  };
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
