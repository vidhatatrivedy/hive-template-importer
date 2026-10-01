import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { reconcile, toExportRows, type ReconcileRow } from "@/core/import/reconcile";
import type { Comment, EditableTree, ImportDraft } from "@/core/import/schemas";
import { formatVerifyTable, summariseDraft, summariseParse, verifyExitCode } from "../../../scripts/verify";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

const HTML_FIXTURES = [
  "InterNACHI Residential -2026-09-30.xls",
  "Residential Template-2026-09-30.xls",
  "InterNACHI Commercial Template-2026-09-30.xls",
  "Room-by-Room Residential Template-2026-09-30.xls",
  "Ben Gromicko's Template for Home Inspections-2026-09-30.xls",
  "Radon Inspection-2026-09-30.xls",
] as const;

const RESIDENTIAL = HTML_FIXTURES[0];
const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";
const RADON = "Radon Inspection-2026-09-30.xls";
const PLAIN_TEXT = "InterNACHI Residential -2026-09-30 (plain text).xls";

describe("reconciliation", () => {
  it("round-trips every HTML fixture with nothing unexplained", async () => {
    for (const file of HTML_FIXTURES) {
      const draft = await draftOf(file);
      const exported = toExportRows(draft.tree, draft);
      expect(exported.map((row) => row.sourceRow), file).toEqual(draft.sourceRows.map((row) => row.rowNumber));
      expect(exported.every((row) => row.cells.length === draft.run.headers.length), file).toBe(true);

      const result = reconcile(draft, draft.tree);
      expect(result.unexplained, file).toBe(0);
      expect(result.verified, file).toBe(result.total);
      expect(result.rows.map((row) => row.sourceRow), file).toEqual(draft.sourceRows.map((row) => row.rowNumber));
      expect(result.rows.every((row) => row.status === "✓"), file).toBe(true);
    }
  });

  it("writes names from the tree and copies raw-only columns from the Source row", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const itemColumn = draft.run.headers.indexOf("Item Name");
    const modifiedColumn = draft.run.headers.indexOf("Last Modified");
    const encoded = draft.sourceRows.find((row) => row.cells[itemColumn] === "Siding, Flashing &amp; Trim");
    expect(encoded).toBeDefined();

    const exported = toExportRows(draft.tree, draft).find((row) => row.sourceRow === encoded?.rowNumber);
    expect(exported?.cells[itemColumn]).toBe("Siding, Flashing & Trim");
    expect(encoded?.cells[modifiedColumn]).toEqual(expect.any(String));
    expect(exported?.cells[modifiedColumn]).toBe(encoded?.cells[modifiedColumn]);
  });

  it("explains a decoded name with the entity-decoding rule", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const itemColumn = draft.run.headers.indexOf("Item Name");
    const encoded = draft.sourceRows.find((row) => row.cells[itemColumn] === "Siding, Flashing &amp; Trim");
    expect(encoded).toBeDefined();

    const result = reconcile(draft, draft.tree);
    const row = rowAt(result.rows, encoded?.rowNumber);
    expect(row?.status).toBe("✓");
    expect(row?.differences).toContainEqual({
      column: "Item Name",
      raw: "Siding, Flashing &amp; Trim",
      stored: "Siding, Flashing & Trim",
      explanation: { rule: "entity-decoding" },
    });
  });

  it("explains a trimmed name only while its whitespace-trimmed issue remains", async () => {
    const draft = await draftOf(BEN);
    const explained = reconcile(draft, draft.tree);
    expect(rowAt(explained.rows, 474)?.differences).toContainEqual({
      column: "Item Name",
      raw: "Water Supply ",
      stored: "Water Supply",
      explanation: { issues: ["whitespace-trimmed"] },
    });

    const stripped = structuredClone(draft);
    stripped.issues = stripped.issues.filter(
      (issue) => !(issue.kind === "whitespace-trimmed" && issue.sourceRow === 474 && detailField(issue.detail) === "Item Name"),
    );
    const broken = reconcile(stripped, stripped.tree);
    expect(rowAt(broken.rows, 474)?.status).toBe("✗");
    expect(rowAt(broken.rows, 474)?.differences).toContainEqual({
      column: "Item Name",
      raw: "Water Supply ",
      stored: "Water Supply",
      explanation: null,
    });
  });

  it("replays Comment text from the row's cuts, and a changed character is unexplained", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const changed = draft.sourceRows.find((row) =>
      draft.issues.some((issue) => issue.sourceRow === row.rowNumber && issue.cuts.length > 0),
    );
    if (!changed) throw new Error("No Source row with cuts");

    const faithful = reconcile(draft, draft.tree);
    const text = rowAt(faithful.rows, changed.rowNumber)?.differences.find((difference) => difference.column === "Comment Text");
    expect(text?.explanation).toEqual({
      issues: draft.issues
        .filter((issue) => issue.sourceRow === changed.rowNumber && issue.cuts.length > 0)
        .map((issue) => issue.kind),
    });

    const corrupted = structuredClone(draft);
    const comment = commentOn(corrupted, changed.rowNumber);
    comment.textHtml = `${comment.textHtml}x`;
    const broken = reconcile(corrupted, corrupted.tree);
    expect(rowAt(broken.rows, changed.rowNumber)?.differences).toContainEqual(
      expect.objectContaining({ column: "Comment Text", stored: comment.textHtml, explanation: null }),
    );
  });

  it("flags a Source row with no Comment", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const removed = draft.tree.sections[0]?.items[0]?.comments.shift();
    expect(removed?.sourceRow).toBeTypeOf("number");

    const result = reconcile(draft, draft.tree);
    expect(result.unexplained).toBeGreaterThan(0);
    expect(result.verified).toBeLessThan(result.total);
    expect(rowAt(result.rows, removed?.sourceRow)?.differences).toContainEqual({
      column: "Comment",
      raw: removed?.sourceRow,
      stored: null,
      explanation: null,
    });
  });

  it("flags two Comments on one Source row", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const comments = draft.tree.sections[0]?.items[0]?.comments;
    const original = comments?.[0];
    if (!comments || !original) throw new Error("Tree has no Comment");
    comments.push(structuredClone(original));

    const result = reconcile(draft, draft.tree);
    expect(rowAt(result.rows, original.sourceRow)?.differences).toContainEqual(
      expect.objectContaining({ column: "Comment", raw: original?.sourceRow, stored: 2, explanation: null }),
    );
  });

  it("flags a Comment whose Source row is null or missing", async () => {
    const missing = structuredClone(await draftOf(RADON));
    const comment = firstComment(missing.tree);
    const original = comment.sourceRow;
    comment.sourceRow = null;
    const nullResult = reconcile(missing, missing.tree);
    expect(nullResult.rows).toContainEqual(
      expect.objectContaining({
        sourceRow: null,
        status: "✗",
        differences: [expect.objectContaining({ column: "Source row", raw: null, explanation: null })],
      }),
    );
    expect(rowAt(nullResult.rows, original)?.status).toBe("✗");

    const absent = structuredClone(await draftOf(RADON));
    firstComment(absent.tree).sourceRow = 99999;
    const absentResult = reconcile(absent, absent.tree);
    expect(absentResult.rows).toContainEqual(
      expect.objectContaining({
        sourceRow: 99999,
        status: "✗",
        differences: [expect.objectContaining({ column: "Source row", raw: 99999, explanation: null })],
      }),
    );
  });

  it("flags Source row numbers that are not strictly increasing", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const item = draft.tree.sections.flatMap((section) => section.items).find((entry) => entry.comments.length >= 2);
    if (!item || item.comments.length < 2) throw new Error("Tree has no Item with two Comments");
    const first = item.comments[0];
    const second = item.comments[1];
    item.comments[0] = second;
    item.comments[1] = first;

    const result = reconcile(draft, draft.tree);
    expect(rowAt(result.rows, first.sourceRow)?.differences).toContainEqual(
      expect.objectContaining({
        column: "Source row",
        raw: second.sourceRow,
        stored: first.sourceRow,
        explanation: null,
      }),
    );
  });

  it("flags an empty Section and an empty Item", async () => {
    const draft = structuredClone(await draftOf(RADON));
    draft.tree.sections.push({ name: "Empty section", items: [] });
    draft.tree.sections[0]?.items.push({ name: "Empty item", comments: [] });

    const result = reconcile(draft, draft.tree);
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        sourceRow: null,
        status: "✗",
        differences: [{ column: "Section", raw: null, stored: "Empty section", explanation: null }],
      }),
    );
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        sourceRow: null,
        status: "✗",
        differences: [{ column: "Item", raw: null, stored: "Empty item", explanation: null }],
      }),
    );
  });

  it("flags an Item boundary the Source rows do not have", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const section = draft.tree.sections.find((entry) => entry.items.some((item) => item.comments.length >= 2));
    const item = section?.items.find((entry) => entry.comments.length >= 2);
    if (!section || !item || item.comments.length < 2) throw new Error("Tree has no Item with two Comments");
    const first = item.comments[0];
    const rest = item.comments.slice(1);
    const index = section.items.indexOf(item);
    section.items.splice(index, 1, { name: item.name, comments: [first] }, { name: item.name, comments: rest });

    const result = reconcile(draft, draft.tree);
    expect(rowAt(result.rows, rest[0]?.sourceRow)?.differences).toContainEqual({
      column: "Item boundary",
      raw: "same",
      stored: "break",
      explanation: null,
    });
  });

  it("compares a typed column this ticket can explain, and reports a change as unexplained", async () => {
    const draft = structuredClone(await draftOf(RADON));
    const comment = firstComment(draft.tree);
    const column = draft.run.headers.indexOf("Comment Type (info, limit, defect)");
    const raw = draft.sourceRows.find((row) => row.rowNumber === comment.sourceRow)?.cells[column];
    comment.commentType = comment.commentType === "info" ? "limit" : "info";

    const result = reconcile(draft, draft.tree);
    expect(rowAt(result.rows, comment.sourceRow)?.differences).toContainEqual({
      column: "Comment Type (info, limit, defect)",
      raw,
      stored: comment.commentType,
      explanation: null,
    });
  });

  it("imports nothing from the parser", () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "reconcile.ts"), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line) || /^\s*export\b/.test(line));
    expect(imports.join("\n")).not.toContain("parse-spectora-export");
  });
});

describe("verify", () => {
  it("prints explained, unexplained, warnings and notices, and fails on an unexplained difference", async () => {
    const residential = await draftOf(RESIDENTIAL);
    const row = summariseDraft(RESIDENTIAL, residential);
    expect(row.unexplained).toBe(0);
    expect(row.warnings).toBe(1);
    expect(row.notices).toBe(11);
    expect(formatVerifyTable([row])).toContain("explained");
    expect(formatVerifyTable([row])).toContain("unexplained");
    expect(formatVerifyTable([row])).toContain("warnings");
    expect(formatVerifyTable([row])).toContain("notices");
    expect(formatVerifyTable([row])).toContain("rejection");
    expect(row.rejection).toBeNull();
    expect(verifyExitCode([row])).toBe(0);

    const plain = summariseParse(
      PLAIN_TEXT,
      await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, PLAIN_TEXT)), PLAIN_TEXT),
    );
    expect(plain.rejection).toBe("plain-text-export");
    expect(formatVerifyTable([plain])).toContain("plain-text-export");
    expect(verifyExitCode([plain])).toBe(0);
    expect(verifyExitCode([{ ...plain, rejection: null }])).toBe(1);
    expect(verifyExitCode([{ ...row, rejection: "not-xlsx" }])).toBe(1);

    const corrupted = structuredClone(await draftOf(RADON));
    firstComment(corrupted.tree).textHtml += "x";
    const broken = summariseDraft(RADON, corrupted);
    expect(broken.unexplained).toBeGreaterThan(0);
    expect(verifyExitCode([broken])).toBe(1);
  });
});

function detailField(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || !("field" in detail)) return null;
  return typeof detail.field === "string" ? detail.field : null;
}

function rowAt(rows: ReconcileRow[], sourceRow: number | null | undefined): ReconcileRow | undefined {
  return rows.find((row) => row.sourceRow === sourceRow);
}

function firstComment(tree: EditableTree): Comment {
  const comment = tree.sections.flatMap((section) => section.items.flatMap((item) => item.comments))[0];
  if (!comment) throw new Error("Tree has no Comment");
  return comment;
}

function commentOn(draft: ImportDraft, sourceRow: number): Comment {
  const comment = draft.tree.sections
    .flatMap((section) => section.items.flatMap((item) => item.comments))
    .find((entry) => entry.sourceRow === sourceRow);
  if (!comment) throw new Error(`No Comment for source row ${sourceRow}`);
  return comment;
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
