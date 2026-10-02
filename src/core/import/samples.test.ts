import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport, type ImportIssue } from "@/core/import";
import { writeSampleFiles } from "../../../scripts/samples";

const REJECTIONS = [
  { file: "no-data-rows.xls", kind: "no-data-rows" },
  { file: "missing-columns.xls", kind: "missing-columns" },
  { file: "unreadable-xlsx.xls", kind: "unreadable-xlsx" },
  { file: "not-xlsx.csv", kind: "not-xlsx" },
  { file: "not-xlsx.pdf", kind: "not-xlsx" },
  { file: "too-large.xls", kind: "too-large" },
] as const;

describe("writeSampleFiles", () => {
  it("writes each checklist sample so the parser rejects or warns as intended", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "samples-"));
    await writeSampleFiles(directory);

    expect(fs.readdirSync(directory).sort()).toEqual(
      [...REJECTIONS.map((sample) => sample.file), "warnings.xls"].sort(),
    );

    for (const sample of REJECTIONS) {
      const bytes = fs.readFileSync(path.join(directory, sample.file));
      const result = await parseSpectoraExport(bytes, sample.file);
      expect(result.ok, sample.file).toBe(false);
      if (result.ok) continue;
      expect(result.rejection.kind, sample.file).toBe(sample.kind);
      if (sample.kind === "missing-columns" && result.rejection.kind === "missing-columns") {
        expect(result.rejection.missing).toEqual(["Item Name", "Comment Type"]);
      }
      if (sample.kind === "too-large" && result.rejection.kind === "too-large") {
        expect(result.rejection.byteSize).toBe(5 * 1024 * 1024);
      }
    }

    const warnings = fs.readFileSync(path.join(directory, "warnings.xls"));
    const imported = await parseSpectoraExport(warnings, "warnings.xls");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.draft.issues.map((issue) => issue.kind).sort()).toEqual([
      "blank-name",
      "split-run",
      "unsafe-style-removed",
    ]);
    expect(imported.draft.issues.filter(isItemSplit)).toHaveLength(1);
  });
});

function isItemSplit(issue: ImportIssue): boolean {
  if (issue.kind !== "split-run" || typeof issue.detail !== "object" || issue.detail === null) return false;
  return "level" in issue.detail && issue.detail.level === "item";
}
