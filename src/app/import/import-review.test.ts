import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { ImportDraft, ImportIssue } from "@/core/import/schemas";
import type { TemplateSummary } from "@/db/schemas";
import { toImportReview } from "@/app/import/import-review";
import { reviewTooltipText } from "@/app/import/review-tooltip";

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

  it("returns the review summary, never the draft's Source rows or tree", async () => {
    const review = toImportReview(await draftOf("Radon Inspection-2026-09-30.xls"), []);
    expect(Object.keys(review).sort()).toEqual(
      [
        "byteSize",
        "counts",
        "filename",
        "issueCounts",
        "notices",
        "previousImport",
        "sha256",
        "suggestedName",
        "warnings",
      ].sort(),
    );
    expect(JSON.stringify(review)).not.toContain("sourceRows");
  });

  it("lists Ben Gromicko's warnings with their locations and groups notices by kind", async () => {
    const review = toImportReview(
      await draftOf("Ben Gromicko's Template for Home Inspections-2026-09-30.xls"),
      [],
    );
    const warning =
      "The frameborder attribute was removed from <iframe>. · Inspection Detail › Buy Back Guarantee › We'll Buy Your Home Back (row 10)";

    expect(review.issueCounts).toEqual({ warning: 2, notice: 75 });
    expect(review.warnings).toEqual({ lines: [warning, warning], more: 0 });
    expect(review.notices).toEqual({
      lines: [
        "Editor leftovers removed ×38",
        "Whitespace trimmed ×15",
        "Boolean default normalised ×12",
        "Duplicate comment ×7",
        "Raw-only content ×2",
        "Stock estimates ×1",
      ],
      more: 0,
    });
    expect(reviewTooltipText(review.warnings)).toEqual([warning, warning]);
    expect(reviewTooltipText(review.notices)).toEqual(review.notices.lines);
  });

  it("names a file-level warning as File and uses the message when the title leaves out the detail", () => {
    const review = toImportReview(
      minimalDraft(
        [
          { kind: "expected-column-missing", sourceRow: null, detail: { column: "Category" }, cuts: [] },
          { kind: "category-missing", sourceRow: 4, detail: {}, cuts: [] },
          { kind: "attribute-removed", sourceRow: 4, detail: { tag: "img", attribute: "onerror" }, cuts: [] },
        ],
        [section("Roof", "Covering", [comment(4, "Flashing")])],
      ),
      [],
    );

    expect(review.warnings.lines).toEqual([
      "Category wasn't in this export, so it was left empty. · File",
      "Category missing · Roof › Covering › Flashing (row 4)",
      "The onerror attribute was removed from <img>. · Roof › Covering › Flashing (row 4)",
    ]);
    expect(review.warnings.more).toBe(0);
  });

  it("caps each tooltip at 6 lines and reports how many warnings or notice kinds remain", () => {
    const warningIssues: ImportIssue[] = Array.from({ length: 8 }, (_, index) => ({
      kind: "category-missing",
      sourceRow: index + 2,
      detail: {},
      cuts: [],
    }));
    const review = toImportReview(
      minimalDraft(
        [
          ...warningIssues,
          { kind: "vocabulary-normalised", sourceRow: 2, detail: { field: "Comment Type" }, cuts: [] },
          { kind: "vocabulary-normalised", sourceRow: 3, detail: { field: "Comment Type" }, cuts: [] },
          { kind: "vocabulary-normalised", sourceRow: 4, detail: { field: "Comment Type" }, cuts: [] },
          { kind: "vocabulary-normalised", sourceRow: 5, detail: { field: "Comment Type" }, cuts: [] },
          { kind: "whitespace-trimmed", sourceRow: 2, detail: { field: "Item Name" }, cuts: [] },
          { kind: "whitespace-trimmed", sourceRow: 3, detail: { field: "Item Name" }, cuts: [] },
          { kind: "whitespace-trimmed", sourceRow: 4, detail: { field: "Item Name" }, cuts: [] },
          { kind: "duplicate-comment", sourceRow: 2, detail: { name: "Roof", commentType: "info", rows: [2, 3] }, cuts: [] },
          { kind: "duplicate-comment", sourceRow: 3, detail: { name: "Roof", commentType: "info", rows: [2, 3] }, cuts: [] },
          { kind: "duplicate-comment", sourceRow: 4, detail: { name: "Roof", commentType: "info", rows: [2, 3] }, cuts: [] },
          { kind: "editor-leftovers", sourceRow: 2, detail: { count: 1 }, cuts: [] },
          { kind: "editor-leftovers", sourceRow: 3, detail: { count: 2 }, cuts: [] },
          { kind: "unknown-column", sourceRow: null, detail: { header: "Notes", column: 9 }, cuts: [] },
          { kind: "stock-estimates", sourceRow: null, detail: { count: 1 }, cuts: [] },
          { kind: "boolean-default-normalised", sourceRow: 2, detail: { value: false }, cuts: [] },
        ],
        [
          section(
            "Roof",
            "Covering",
            warningIssues.map((issue, index) => comment(issue.sourceRow ?? index + 2, `Comment ${index + 1}`)),
          ),
        ],
      ),
      [],
    );

    expect(review.warnings.lines).toEqual([
      "Category missing · Roof › Covering › Comment 1 (row 2)",
      "Category missing · Roof › Covering › Comment 2 (row 3)",
      "Category missing · Roof › Covering › Comment 3 (row 4)",
      "Category missing · Roof › Covering › Comment 4 (row 5)",
      "Category missing · Roof › Covering › Comment 5 (row 6)",
      "Category missing · Roof › Covering › Comment 6 (row 7)",
    ]);
    expect(review.warnings.more).toBe(2);
    expect(reviewTooltipText(review.warnings).at(-1)).toBe("+ 2 more");
    expect(review.notices).toEqual({
      lines: [
        "Vocabulary normalised ×4",
        "Whitespace trimmed ×3",
        "Duplicate comment ×3",
        "Editor leftovers removed ×2",
        "Unknown column ×1",
        "Stock estimates ×1",
      ],
      more: 1,
    });
    expect(reviewTooltipText(review.notices).at(-1)).toBe("+ 1 more");
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

function minimalDraft(issues: ImportIssue[], sections: ImportDraft["tree"]["sections"]): ImportDraft {
  return {
    suggestedName: "Sample",
    run: {
      filename: "sample.xls",
      sha256: "ab".repeat(32),
      byteSize: 12,
      sheetName: "Report",
      headers: ["Section Name"],
      rowsRead: 8,
      blankRows: 0,
      valuesDecoded: 0,
    },
    sourceRows: [],
    issues,
    tree: { sections },
  };
}

type DraftComment = ImportDraft["tree"]["sections"][number]["items"][number]["comments"][number];

function section(sectionName: string, itemName: string, comments: DraftComment[]) {
  return { name: sectionName, items: [{ name: itemName, comments }] };
}

function comment(sourceRow: number, name: string): DraftComment {
  return {
    sourceRow,
    name,
    textHtml: "",
    commentType: "info",
    category: null,
    recommendation: null,
    answerType: "boolean",
    defaultBoolean: null,
    defaultText: null,
    choiceOptions: [],
    unitOptions: [],
  };
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
