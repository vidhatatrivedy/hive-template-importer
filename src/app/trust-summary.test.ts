import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { EditableTree, ImportDraft } from "@/core/import/schemas";
import { buildTrustReport } from "@/core/import/trust-report";
import { NOT_REVERIFIED } from "@/app/report-base";
import { formatFileSize, trustSummaryView } from "@/app/trust-summary";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/spectora");
const RESIDENTIAL = "InterNACHI Residential -2026-09-30.xls";
const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";

describe("trustSummaryView", () => {
  it("shows InterNACHI Residential as fully verified, with no Version label at Version 1", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const view = trustSummaryView(buildTrustReport(draft, draft.tree), 1);

    expect(view.rowFlow).toBe("392 rows read → 0 blank rows → 392 Comments stored");
    expect(view.verdict).toBe("392 / 392 rows verified");
    expect(view.failure).toBeNull();
    expect(view.marksVerdict).toBe(true);
    expect(view.fileSize).toBe("54.3 KB");
    expect(view.versionLabel).toBeNull();
  });

  it("says which Version the Template is now at, and keeps the verdict", async () => {
    const draft = await draftOf(BEN);
    const report = buildTrustReport(draft, draft.tree);
    const view = trustSummaryView(report, 2);

    expect(view.versionLabel).toBe("Describes Version 1, as imported. This Template is now at Version 2.");
    expect(view.verdict).toBe(`${report.summary.verdict.total} / ${report.summary.verdict.total} rows verified`);
    expect(view.failure).toBeNull();
  });

  it("names the rows that don't match what was stored, as an importer bug", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const tree = structuredClone(draft.tree);
    const first = commentAt(tree, 0, 0, 0);
    const second = commentAt(tree, 2, 0, 0);
    first.name = `${first.name} (changed)`;
    second.name = `${second.name} (changed)`;
    const view = trustSummaryView(buildTrustReport(draft, tree), 1);

    expect(view.verdict).toBe("390 / 392 rows verified");
    expect(view.failure).toEqual({
      message: "✗ 2 of 392 rows don't match what was stored. This is a bug in the importer.",
      sourceRows: [first.sourceRow, second.sourceRow],
    });
    expect(view.marksVerdict).toBe(false);
  });

  it("says Not re-verified, with no failure list, once the imported Template is gone", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const view = trustSummaryView(buildTrustReport(draft, draft.tree), 4, "unverifiable");

    expect(view.verdict).toBe(NOT_REVERIFIED);
    expect(view.failure).toBeNull();
    expect(view.marksVerdict).toBe(false);
    expect(view.versionLabel).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("reads bytes, KB and MB with 1 KB = 1024 bytes", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(1)).toBe("1 byte");
    expect(formatFileSize(1023)).toBe("1023 bytes");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(55565)).toBe("54.3 KB");
    expect(formatFileSize(4 * 1024 * 1024)).toBe("4.0 MB");
  });
});

function commentAt(tree: EditableTree, section: number, item: number, comment: number) {
  const found = tree.sections[section]?.items[item]?.comments[comment];
  if (!found) throw new Error("No such Comment");
  return found;
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
