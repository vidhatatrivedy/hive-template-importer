import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { reconcile, type Difference, type ReconcileResult, type ReconcileRow } from "@/core/import/reconcile";
import type { Comment, ImportDraft, Item, Section } from "@/core/import/schemas";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";
const RADON = "Radon Inspection-2026-09-30.xls";

/**
 * Seam: `reconcile(evidence, tree)`. Each test corrupts one fixture draft and
 * asserts the Unexplained difference lands on that Source row, or on the Section
 * or Item the corruption moved.
 */
describe("reconciliation can fail", () => {
  it("reports a changed character of stored text on that Source row", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const { section, item, comment } = placed(draft, 2);
    expect(section.name).toBe("Details");
    expect(item.name).toBe("General");
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    comment.textHtml = `${comment.textHtml}x`;

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([2]);
    expect(unexplained(rowAt(result, 2))).toEqual([
      {
        column: "Comment Text",
        raw: cell(draft, 2, "Comment Text"),
        stored: comment.textHtml,
        explanation: null,
      },
    ]);
  });

  it("reports a dropped Comment on its Source row", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const { section, item } = placed(draft, 2);
    expect(section.name).toBe("Details");
    expect(item.name).toBe("General");
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    const dropped = item.comments.shift();
    expect(dropped?.sourceRow).toBe(2);

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([2]);
    expect(unexplained(rowAt(result, 2))).toEqual([
      { column: "Comment", raw: 2, stored: null, explanation: null },
    ]);
  });

  it("reports swapped Comments on the Source row that is out of order", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const { section, item } = placed(draft, 2);
    expect(section.name).toBe("Details");
    expect(item.name).toBe("General");
    const first = commentAt(item, 0);
    const second = commentAt(item, 1);
    expect(first.sourceRow).toBe(2);
    expect(second.sourceRow).toBe(3);
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    item.comments[0] = second;
    item.comments[1] = first;

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([2]);
    expect(unexplained(rowAt(result, 2))).toEqual([
      { column: "Source row", raw: 3, stored: 2, explanation: null },
    ]);
  });

  it("reports a Comment moved to the next Item on the Item boundary", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const section = sectionNamed(draft, "Details");
    const general = itemNamed(section, "General");
    const monitor = itemNamed(section, "Monitor Type");
    expect(general.comments.at(-1)?.sourceRow).toBe(7);
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    const moved = general.comments.pop();
    if (!moved) throw new Error("General has no Comment");
    monitor.comments.unshift(moved);

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([7, 8]);
    expect(unexplained(rowAt(result, 7))).toEqual([
      { column: "Item Name", raw: "General", stored: "Monitor Type", explanation: null },
      { column: "Item boundary", raw: "same", stored: "break", explanation: null },
    ]);
    expect(unexplained(rowAt(result, 8))).toEqual([
      { column: "Item boundary", raw: "break", stored: "same", explanation: null },
    ]);
  });

  it("reports merged Items on the Source row where the Item break was lost", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const section = sectionNamed(draft, "Details");
    const general = itemNamed(section, "General");
    const monitor = itemNamed(section, "Monitor Type");
    expect(monitor.comments.map((comment) => comment.sourceRow)).toEqual([8, 9]);
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    general.comments.push(...monitor.comments);
    section.items.splice(section.items.indexOf(monitor), 1);

    const result = reconcile(draft, draft.tree);
    expect(section.items.map((item) => item.name)).toEqual(["General"]);
    expect(failedSourceRows(result)).toEqual([8, 9]);
    expect(unexplained(rowAt(result, 8))).toEqual([
      { column: "Item Name", raw: "Monitor Type", stored: "General", explanation: null },
      { column: "Item boundary", raw: "break", stored: "same", explanation: null },
    ]);
    expect(unexplained(rowAt(result, 9))).toEqual([
      { column: "Item Name", raw: "Monitor Type", stored: "General", explanation: null },
    ]);
  });

  it("reports a removed whitespace-trimmed issue on that Item's Source row", async () => {
    const draft = structuredClone(await draftOf(BEN));
    const { section, item } = placed(draft, 474);
    expect(section.name).toBe("Plumbing");
    expect(item.name).toBe("Water Supply");
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    draft.issues = draft.issues.filter(
      (issue) =>
        !(issue.kind === "whitespace-trimmed" && issue.sourceRow === 474 && detailField(issue.detail) === "Item Name"),
    );

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([474]);
    expect(unexplained(rowAt(result, 474))).toEqual([
      {
        column: "Item Name",
        raw: "Water Supply ",
        stored: "Water Supply",
        explanation: null,
      },
    ]);
  });

  it("reports a removed cut on that Comment's Source row", async () => {
    const draft = structuredClone(await draftOf(BEN));
    const { section, item } = placed(draft, 10);
    expect(section.name).toBe("Inspection Detail");
    expect(item.name).toBe("Buy Back Guarantee");
    const issue = draft.issues.find((entry) => entry.sourceRow === 10 && entry.kind === "editor-leftovers");
    if (!issue || issue.cuts.length < 2) throw new Error("Row 10 has no editor-leftovers cut to remove");
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    issue.cuts.splice(0, 1);

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([10]);
    expect(unexplained(rowAt(result, 10))).toEqual([
      {
        column: "Comment Text",
        raw: cell(draft, 10, "Comment Text"),
        stored: cellStored(draft, 10),
        explanation: null,
      },
    ]);
  });

  it("reports a null Source row on that Comment and on the Source row it left", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const { section, item, comment } = placed(draft, 2);
    expect(section.name).toBe("Details");
    expect(item.name).toBe("General");
    expect(reconcile(draft, draft.tree).unexplained).toBe(0);

    comment.sourceRow = null;

    const result = reconcile(draft, draft.tree);
    expect(failedSourceRows(result)).toEqual([2, null]);
    expect(unexplained(rowAt(result, 2))).toEqual([
      { column: "Comment", raw: 2, stored: null, explanation: null },
    ]);
    expect(result.rows.filter((row) => row.sourceRow === null)).toEqual([
      {
        sourceRow: null,
        status: "✗",
        differences: [{ column: "Source row", raw: null, stored: null, explanation: null }],
      },
    ]);
  });
});

function unexplained(row: ReconcileRow | undefined): Difference[] {
  return (row?.differences ?? []).filter((difference) => difference.explanation === null);
}

function failedSourceRows(result: ReconcileResult): (number | null)[] {
  return result.rows.filter((row) => row.status === "✗").map((row) => row.sourceRow);
}

function rowAt(result: ReconcileResult, sourceRow: number): ReconcileRow | undefined {
  return result.rows.find((row) => row.sourceRow === sourceRow);
}

function cell(draft: ImportDraft, sourceRow: number, header: string): ImportDraft["sourceRows"][number]["cells"][number] {
  const index = draft.run.headers.indexOf(header);
  const row = draft.sourceRows.find((entry) => entry.rowNumber === sourceRow);
  if (!row || index < 0) throw new Error(`No ${header} cell on Source row ${sourceRow}`);
  return row.cells[index] ?? null;
}

function cellStored(draft: ImportDraft, sourceRow: number): string {
  return placed(draft, sourceRow).comment.textHtml;
}

function placed(draft: ImportDraft, sourceRow: number): { section: Section; item: Item; comment: Comment } {
  for (const section of draft.tree.sections) {
    for (const item of section.items) {
      const comment = item.comments.find((entry) => entry.sourceRow === sourceRow);
      if (comment) return { section, item, comment };
    }
  }
  throw new Error(`No Comment for Source row ${sourceRow}`);
}

function sectionNamed(draft: ImportDraft, name: string): Section {
  const section = draft.tree.sections.find((entry) => entry.name === name);
  if (!section) throw new Error(`No Section ${name}`);
  return section;
}

function itemNamed(section: Section, name: string): Item {
  const item = section.items.find((entry) => entry.name === name);
  if (!item) throw new Error(`No Item ${name}`);
  return item;
}

function commentAt(item: Item, index: number): Comment {
  const comment = item.comments[index];
  if (!comment) throw new Error(`Item ${item.name} has no Comment at ${index}`);
  return comment;
}

function detailField(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || !("field" in detail)) return null;
  return typeof detail.field === "string" ? detail.field : null;
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
