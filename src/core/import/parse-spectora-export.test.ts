import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { catalogue, renderIssueMessage, type IssueKind } from "@/core/import/catalogue";
import { MAX_UPLOAD_BYTES, rejectionMessage } from "@/core/import/rejections";
import { parseSpectoraExport, type ParseResult } from "@/core/import/parse-spectora-export";
import { reconcile, toExportRows, type Cell, type ReconcileRow } from "@/core/import/reconcile";
import { sanitiseCommentHtml, type Cut } from "@/core/sanitise";
import {
  countEditableTree,
  editableTreeSchema,
  importDraftSchema,
  type Comment,
  type EditableTree,
  type ImportDraft,
} from "@/core/import/schemas";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

/**
 * Counts from fixtures/spectora/README.md. Hashes and byte sizes from `sha256sum`.
 * `valuesDecoded` is the number of normalised plain-text cells whose text changes when `&amp;` is decoded once.
 */
const HTML_FIXTURES = [
  {
    file: "InterNACHI Residential -2026-09-30.xls",
    rows: 392,
    sections: 13,
    items: 69,
    suggestedName: "InterNACHI Residential",
    sha256: "4aeb50adbac211fca9a930d71262dba0b597cb80ece1a3230def862d6d1436e8",
    byteSize: 55565,
    valuesDecoded: 252,
  },
  {
    file: "Residential Template-2026-09-30.xls",
    rows: 395,
    sections: 13,
    items: 70,
    suggestedName: "Residential Template",
    sha256: "3451ceadabe9061274b5d05950d25c7339b12e39764f760a31d1177963e48cab",
    byteSize: 55686,
    valuesDecoded: 252,
  },
  {
    file: "InterNACHI Commercial Template-2026-09-30.xls",
    rows: 406,
    sections: 15,
    items: 67,
    suggestedName: "InterNACHI Commercial Template",
    sha256: "fc976b1d071e4b5c921155ada3009cc0cfe2e6dbf01557393e83564c8465d04c",
    byteSize: 57951,
    valuesDecoded: 199,
  },
  {
    file: "Room-by-Room Residential Template-2026-09-30.xls",
    rows: 798,
    sections: 22,
    items: 136,
    suggestedName: "Room-by-Room Residential Template",
    sha256: "9787a9fa86bd5a419815274e43fa4752d1727f66d331f1c61f80c84b67820f89",
    byteSize: 104950,
    valuesDecoded: 295,
  },
  {
    file: "Ben Gromicko's Template for Home Inspections-2026-09-30.xls",
    rows: 1248,
    sections: 17,
    items: 133,
    suggestedName: "Ben Gromicko's Template for Home Inspections",
    sha256: "871261ea06ac8b32e0827099b48fa589a061baa7cab983aa7289d9c2347c35d6",
    byteSize: 182834,
    valuesDecoded: 561,
  },
  {
    file: "Radon Inspection-2026-09-30.xls",
    rows: 10,
    sections: 2,
    items: 3,
    suggestedName: "Radon Inspection",
    sha256: "e2c0c922282598c46eb9380bad652418388e77166f11d1e46caa15b5fff2e598",
    byteSize: 7155,
    valuesDecoded: 0,
  },
] as const;

/** Verbatim header row, identical in every fixture. */
const HEADERS = [
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Unit Type Options (numeric answers only, comma-separated)",
  "Recommendation (from list)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
  "Default Value",
  'Default Value 2 (for "range" types)',
  'Default Unit Type (for "number" and "range" types)',
  "Default Location",
  "Default Estimate Min",
  "Default Estimate Max",
  "Locked",
  "Simple Format",
  "Disable Photos",
  "Uses",
  "Default Photo 1",
  "Default Photo 1 Caption",
  "Default Photo 2",
  "Default Photo 2 Caption",
  "Default Photo 3",
  "Default Photo 3 Caption",
  "Default Photo 4",
  "Default Photo 4 Caption",
  "Default Photo 5",
  "Default Photo 5 Caption",
  "Default Photo 6",
  "Default Photo 6 Caption",
  "Default Photo 7",
  "Default Photo 7 Caption",
  "Default Photo 8",
  "Default Photo 8 Caption",
  "Default Photo 9",
  "Default Photo 9 Caption",
  "Default Photo 10",
  "Default Photo 10 Caption",
  "Last Modified",
];

function commentsIn(tree: EditableTree): Comment[] {
  return tree.sections.flatMap((section) => section.items.flatMap((item) => item.comments));
}

function commentOn(draft: ImportDraft, sourceRow: number): Comment {
  const comment = commentsIn(draft.tree).find((entry) => entry.sourceRow === sourceRow);
  if (!comment) throw new Error(`No Comment for source row ${sourceRow}`);
  return comment;
}

describe("parseSpectoraExport", () => {
  it("parses each HTML fixture to the README's rows, sections and items", async () => {
    for (const fixture of HTML_FIXTURES) {
      const draft = await draftOf(fixture.file);
      expect(draft.run.blankRows, fixture.file).toBe(0);
      expect(draft.run.rowsRead, fixture.file).toBe(fixture.rows);
      expect(draft.sourceRows, fixture.file).toHaveLength(fixture.rows);
      expect(draft.sourceRows[0]?.rowNumber, fixture.file).toBe(2);

      const counts = countEditableTree(draft.tree);
      expect(counts, fixture.file).toEqual({
        sections: fixture.sections,
        items: fixture.items,
        comments: fixture.rows,
      });

      const draftParsed = importDraftSchema.safeParse(draft);
      expect(draftParsed.success, draftParsed.success ? fixture.file : JSON.stringify(draftParsed.error.issues)).toBe(true);
      const treeParsed = editableTreeSchema.safeParse(draft.tree);
      expect(treeParsed.success, treeParsed.success ? fixture.file : JSON.stringify(treeParsed.error.issues)).toBe(true);
    }
  });

  it("records run metadata, the verbatim header and a suggested name without the export date", async () => {
    for (const fixture of HTML_FIXTURES) {
      const draft = await draftOf(fixture.file);

      expect(draft.suggestedName, fixture.file).toBe(fixture.suggestedName);
      expect(draft.run, fixture.file).toMatchObject({
        filename: fixture.file,
        sha256: fixture.sha256,
        byteSize: fixture.byteSize,
        sheetName: "Sheet1",
        rowsRead: fixture.rows,
        blankRows: 0,
        valuesDecoded: fixture.valuesDecoded,
      });
      expect(draft.run.headers, fixture.file).toEqual(HEADERS);
    }
  });

  it("stores Comment text as the sanitiser's html and leaves the source cell raw", async () => {
    const draft = await draftOf("Ben Gromicko's Template for Home Inspections-2026-09-30.xls");
    const column = draft.run.headers.indexOf("Comment Text");
    let changed = 0;
    for (const row of draft.sourceRows) {
      const raw = row.cells[column];
      const text = typeof raw === "string" ? raw : "";
      expect(commentOn(draft, row.rowNumber).textHtml).toBe(sanitiseCommentHtml(text).html);
      if (text !== sanitiseCommentHtml(text).html) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("keeps Last Modified as the string the reader returns", async () => {
    const draft = await draftOf("InterNACHI Residential -2026-09-30.xls");
    const column = draft.run.headers.indexOf("Last Modified");
    expect(draft.sourceRows[0]?.cells[column]).toBe("09/30/2026 03:30:34");
  });

  it("stores names with & and leaves the source cell encoded", async () => {
    const draft = await draftOf("InterNACHI Residential -2026-09-30.xls");
    expect(draft.tree.sections.map((section) => section.name)).toContain("Attic, Insulation & Ventilation");
    for (const section of draft.tree.sections) {
      expect(section.name).not.toContain("&amp;");
      for (const item of section.items) {
        expect(item.name).not.toContain("&amp;");
        for (const comment of item.comments) expect(comment.name).not.toContain("&amp;");
      }
    }

    const itemColumn = draft.run.headers.indexOf("Item Name");
    const encoded = draft.sourceRows.find((row) => row.cells[itemColumn] === "Siding, Flashing &amp; Trim");
    expect(encoded).toBeDefined();
    const stored = draft.tree.sections
      .flatMap((section) => section.items)
      .find((item) => item.comments.some((comment) => comment.sourceRow === encoded?.rowNumber));
    expect(stored?.name).toBe("Siding, Flashing & Trim");
  });

  it("puts Residential's Dev item first in Inspection Details and reads its fields", async () => {
    const draft = await draftOf("Residential Template-2026-09-30.xls");
    const details = draft.tree.sections[0];
    expect(details?.name).toBe("Inspection Details");
    const dev = details?.items[0];
    expect(dev?.name).toBe("Dev");
    expect(dev?.comments.map((comment) => comment.sourceRow)).toEqual([2, 3, 4]);
    expect(dev?.comments.map((comment) => commentFields(comment))).toEqual([
      {
        name: "lim one text",
        commentType: "limit",
        answerType: "text",
        category: null,
        recommendation: "pro",
        choiceOptions: [],
        unitOptions: [],
        defaultBoolean: null,
        defaultText: null,
        textHtml: "",
      },
      {
        name: "info one checkboc",
        commentType: "info",
        answerType: "boolean",
        category: null,
        recommendation: "pro",
        choiceOptions: [],
        unitOptions: [],
        defaultBoolean: null,
        defaultText: null,
        textHtml: "",
      },
      {
        name: "info two text",
        commentType: "info",
        answerType: "checkbox",
        category: null,
        recommendation: "pro",
        choiceOptions: ["concrete", "wood", "metal"],
        unitOptions: [],
        defaultBoolean: null,
        defaultText: null,
        textHtml: "",
      },
    ]);
  });

  it("reads a defect Category and an exact true default", async () => {
    const draft = await draftOf("InterNACHI Residential -2026-09-30.xls");
    const cracking = commentOn(draft, 10);
    expect(cracking.name).toBe("Cracking - Major");
    expect(cracking.commentType).toBe("defect");
    expect(cracking.category).toBe(0);

    const responsibility = commentOn(draft, 126);
    expect(responsibility.name).toBe("Homeowner's Responsibility");
    expect(responsibility.answerType).toBe("boolean");
    expect(responsibility.defaultBoolean).toBe(true);
    expect(responsibility.defaultText).toBeNull();
    expect(draft.issues.filter((issue) => issue.kind === "boolean-default-normalised")).toEqual([]);
  });

  it("stores Ben's f defaults as false, each with boolean-default-normalised", async () => {
    const draft = await draftOf("Ben Gromicko's Template for Home Inspections-2026-09-30.xls");
    expect(catalogueEntry("boolean-default-normalised")).toMatchObject({
      level: "row",
      severity: "notice",
      class: "Changed",
    });
    expect(renderIssueMessage("boolean-default-normalised", { value: false })).toBe("Default Value was stored as no.");
    expect(renderIssueMessage("boolean-default-normalised", { value: true })).toBe("Default Value was stored as yes.");

    const sourceRowsWithF = [71, 141, 245, 263, 278, 285, 294, 340, 368, 573, 575, 1142];
    expect(draft.issues.filter((issue) => issue.kind === "boolean-default-normalised").map((issue) => issue.sourceRow)).toEqual(
      sourceRowsWithF,
    );
    for (const rowNumber of sourceRowsWithF) {
      const comment = commentOn(draft, rowNumber);
      expect(comment.defaultBoolean, String(rowNumber)).toBe(false);
      expect(comment.defaultText, String(rowNumber)).toBeNull();
      expect(draft.issues).toContainEqual({
        kind: "boolean-default-normalised",
        sourceRow: rowNumber,
        detail: { value: false },
        cuts: [],
      });
    }
    const defaultColumn = draft.run.headers.indexOf(DEFAULT_VALUE);
    for (const rowNumber of sourceRowsWithF) {
      expect(draft.sourceRows.find((row) => row.rowNumber === rowNumber)?.cells[defaultColumn], String(rowNumber)).toBe("f");
    }

    expect(commentOn(draft, 7).defaultBoolean).toBe(true);
    expect(commentOn(draft, 22).defaultBoolean).toBe(false);
    expect(draft.issues.filter((issue) => issue.sourceRow === 7 || issue.sourceRow === 22)).not.toContainEqual(
      expect.objectContaining({ kind: "boolean-default-normalised" }),
    );

    const attendance = commentOn(draft, 3);
    expect(attendance.answerType).toBe("checkbox");
    expect(attendance.defaultBoolean).toBeNull();
    expect(attendance.defaultText).toBe("Client");
    expect(attendance.choiceOptions).toEqual([
      "Client",
      "Client's Agent",
      "Home Owner",
      "Listing Agent",
      "Family of My Client",
      "Just the Inspector",
    ]);
    expect(draft.issues.filter((issue) => issue.sourceRow === 3 && issue.kind === "checkbox-default-not-in-options")).toEqual(
      [],
    );
  });

  it("stores odd defaults and option lists, and explains each change", async () => {
    const draft = await defaultsDraft();

    expect(catalogueEntry("boolean-default-invalid")).toMatchObject({ level: "row", severity: "warning", class: "Changed" });
    expect(catalogueEntry("checkbox-default-not-in-options")).toMatchObject({ level: "row", severity: "notice", class: "Check" });
    expect(catalogueEntry("empty-option-dropped")).toMatchObject({ level: "row", severity: "notice", class: "Changed" });
    expect(catalogueEntry("options-orphan")).toMatchObject({ level: "row", severity: "notice", class: "Check" });
    expect(renderIssueMessage("boolean-default-invalid", {})).toBe(
      "Default Value wasn't a yes/no value, so none was stored.",
    );
    expect(renderIssueMessage("checkbox-default-not-in-options", { value: "Other" })).toBe(
      `Default Value "Other" isn't one of the choice options.`,
    );
    expect(renderIssueMessage("empty-option-dropped", { field: CHOICE_OPTIONS })).toBe(
      "An empty entry was dropped from Multiple Choice Options.",
    );
    expect(renderIssueMessage("options-orphan", {})).toBe("Choice options were kept on a Comment that isn't a checkbox.");

    expect(storedDefaults(draft)).toEqual([
      { name: "Lower t", answerType: "boolean", defaultBoolean: true, defaultText: null, choiceOptions: [], unitOptions: [] },
      { name: "Upper F", answerType: "boolean", defaultBoolean: false, defaultText: null, choiceOptions: [], unitOptions: [] },
      { name: "Padded true", answerType: "boolean", defaultBoolean: true, defaultText: null, choiceOptions: [], unitOptions: [] },
      { name: "Maybe", answerType: "boolean", defaultBoolean: null, defaultText: null, choiceOptions: [], unitOptions: [] },
      { name: "Exact true", answerType: "boolean", defaultBoolean: true, defaultText: null, choiceOptions: [], unitOptions: [] },
      { name: "Xlsx false", answerType: "boolean", defaultBoolean: false, defaultText: null, choiceOptions: [], unitOptions: [] },
      {
        name: "Not an option",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: "Other",
        choiceOptions: ["Client", "Agent"],
        unitOptions: [],
      },
      {
        name: "Trimmed missing",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: "Other",
        choiceOptions: ["Client", "Agent"],
        unitOptions: [],
      },
      {
        name: "Trimmed present",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: "Client",
        choiceOptions: ["Client", "Agent"],
        unitOptions: [],
      },
      {
        name: "Empty entry",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: ["wood", "metal"],
        unitOptions: [],
      },
      {
        name: "Spaced options",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: ["wood", "metal"],
        unitOptions: [],
      },
      {
        name: "Duplicate options",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: ["a", "a"],
        unitOptions: [],
      },
      {
        name: "Text options",
        answerType: "text",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: ["Yes", "No"],
        unitOptions: [],
      },
      {
        name: "Unit empty",
        answerType: "number",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: [],
        unitOptions: ["F", "C"],
      },
      {
        name: "Decoded default",
        answerType: "text",
        defaultBoolean: null,
        defaultText: "&lt;",
        choiceOptions: [],
        unitOptions: [],
      },
      {
        name: "Decoded option",
        answerType: "checkbox",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: ["&lt;"],
        unitOptions: [],
      },
      {
        name: "Text trim",
        answerType: "text",
        defaultBoolean: null,
        defaultText: "hello",
        choiceOptions: [],
        unitOptions: [],
      },
      {
        name: "Blank boolean",
        answerType: "boolean",
        defaultBoolean: null,
        defaultText: null,
        choiceOptions: [],
        unitOptions: [],
      },
    ]);

    expect(draft.run.valuesDecoded).toBe(2);
    expect(sourceCell(draft, "Decoded default", DEFAULT_VALUE)).toBe("&amp;lt;");
    expect(sourceCell(draft, "Decoded option", CHOICE_OPTIONS)).toBe("&amp;lt;");
    expect(commentOn(draft, sourceRow(draft, "Decoded default")).defaultText).not.toBe("<");
    expect(commentOn(draft, sourceRow(draft, "Decoded option")).choiceOptions).not.toContain("<");
    expect(sourceCell(draft, "Xlsx false", DEFAULT_VALUE)).toBe(false);

    expect(defaultIssues(draft, "Lower t")).toEqual([issue(draft, "Lower t", "boolean-default-normalised", { value: true })]);
    expect(defaultIssues(draft, "Upper F")).toEqual([issue(draft, "Upper F", "boolean-default-normalised", { value: false })]);
    expect(defaultIssues(draft, "Padded true")).toEqual([
      issue(draft, "Padded true", "boolean-default-normalised", { value: true }),
    ]);
    expect(defaultIssues(draft, "Maybe")).toEqual([issue(draft, "Maybe", "boolean-default-invalid", {})]);
    expect(defaultIssues(draft, "Exact true")).toEqual([]);
    expect(defaultIssues(draft, "Xlsx false")).toEqual([]);
    expect(defaultIssues(draft, "Not an option")).toEqual([
      issue(draft, "Not an option", "checkbox-default-not-in-options", { value: "Other" }),
    ]);
    expect(defaultIssues(draft, "Trimmed missing")).toEqual([
      issue(draft, "Trimmed missing", "whitespace-trimmed", { field: DEFAULT_VALUE }),
      issue(draft, "Trimmed missing", "checkbox-default-not-in-options", { value: "Other" }),
    ]);
    expect(defaultIssues(draft, "Trimmed present")).toEqual([
      issue(draft, "Trimmed present", "whitespace-trimmed", { field: DEFAULT_VALUE }),
    ]);
    expect(defaultIssues(draft, "Empty entry")).toEqual([
      issue(draft, "Empty entry", "empty-option-dropped", { field: CHOICE_OPTIONS }),
    ]);
    expect(defaultIssues(draft, "Spaced options")).toEqual([]);
    expect(defaultIssues(draft, "Duplicate options")).toEqual([]);
    expect(defaultIssues(draft, "Text options")).toEqual([issue(draft, "Text options", "options-orphan", {})]);
    expect(defaultIssues(draft, "Unit empty")).toEqual([
      issue(draft, "Unit empty", "empty-option-dropped", { field: UNIT_OPTIONS }),
    ]);
    expect(defaultIssues(draft, "Decoded default")).toEqual([]);
    expect(defaultIssues(draft, "Decoded option")).toEqual([]);
    expect(defaultIssues(draft, "Text trim")).toEqual([
      issue(draft, "Text trim", "whitespace-trimmed", { field: DEFAULT_VALUE }),
    ]);
    expect(defaultIssues(draft, "Blank boolean")).toEqual([]);

    expectRoundTrip(draft);
    const result = reconcile(draft, draft.tree);
    for (const name of ["Exact true", "Xlsx false", "Blank boolean"]) {
      expect(differencesOn(result.rows, sourceRow(draft, name), DEFAULT_VALUE), name).toEqual([]);
    }
    expect(differencesOn(result.rows, sourceRow(draft, "Duplicate options"), CHOICE_OPTIONS)).toEqual([]);
    for (const flagged of DEFAULT_FLAGGED) {
      const rowNumber = sourceRow(draft, flagged.name);
      expect(differencesOn(result.rows, rowNumber, flagged.difference.column), flagged.name).toContainEqual(flagged.difference);
      if (flagged.kind === null) continue;

      const stripped = structuredClone(draft);
      const index = stripped.issues.findIndex((issue) => issue.sourceRow === rowNumber && issue.kind === flagged.kind);
      expect(index, flagged.name).toBeGreaterThanOrEqual(0);
      stripped.issues.splice(index, 1);
      const broken = reconcile(stripped, stripped.tree);
      expect(broken.rows.find((row) => row.sourceRow === rowNumber)?.status, flagged.name).toBe("✗");
      expect(differencesOn(broken.rows, rowNumber, flagged.difference.column), flagged.name).toContainEqual({
        ...flagged.difference,
        explanation: null,
      });
    }

    const spaced = structuredClone(draft);
    const spacedComment = commentsIn(spaced.tree).find((comment) => comment.name === "Spaced options");
    if (!spacedComment) throw new Error("Spaced options was not stored");
    spacedComment.choiceOptions = ["wood", "metal", "extra"];
    const corrupted = reconcile(spaced, spaced.tree);
    expect(differencesOn(corrupted.rows, sourceRow(draft, "Spaced options"), CHOICE_OPTIONS)).toContainEqual({
      column: CHOICE_OPTIONS,
      raw: "wood,metal",
      stored: "wood, metal, extra",
      explanation: null,
    });
  });

  it("stores odd Comment types, Answer types and Categories with a named fallback", async () => {
    const draft = await vocabularyDraft();

    expect(catalogueEntry("vocabulary-normalised")).toMatchObject({ level: "row", severity: "notice", class: "Changed" });
    expect(catalogueEntry("comment-type-fallback")).toMatchObject({ level: "row", severity: "warning", class: "Changed" });
    expect(catalogueEntry("answer-type-fallback")).toMatchObject({ level: "row", severity: "warning", class: "Changed" });
    expect(catalogueEntry("category-missing")).toMatchObject({ level: "row", severity: "warning", class: "Changed" });
    expect(catalogueEntry("category-orphan")).toMatchObject({ level: "row", severity: "notice", class: "Check" });
    expect(renderIssueMessage("vocabulary-normalised", { field: COMMENT_TYPE })).toBe("Comment Type was re-cased or trimmed.");
    expect(renderIssueMessage("comment-type-fallback", {})).toBe(
      "Comment Type was blank or not a known value, so it was stored as Informational.",
    );
    expect(renderIssueMessage("answer-type-fallback", {})).toBe(
      "Answer Type was blank or not a known value, so it was stored as yes/no.",
    );
    expect(renderIssueMessage("category-missing", {})).toBe("This defect has no valid Category, so none was stored.");
    expect(renderIssueMessage("category-orphan", { category: 1 })).toBe(
      "Category 1 was kept on an Informational or Limitation Comment.",
    );

    expect(storedFields(draft)).toEqual([
      { name: "Odd defect", commentType: "defect", answerType: "boolean", category: 0 },
      { name: "Unknown type", commentType: "info", answerType: "boolean", category: null },
      { name: "Blank type", commentType: "info", answerType: "boolean", category: null },
      { name: "Odd answer", commentType: "info", answerType: "text", category: null },
      { name: "Unknown answer", commentType: "info", answerType: "boolean", category: null },
      { name: "Blank answer", commentType: "info", answerType: "boolean", category: null },
      { name: "No category", commentType: "defect", answerType: "boolean", category: null },
      { name: "Invalid category", commentType: "defect", answerType: "boolean", category: null },
      { name: "Info category", commentType: "info", answerType: "boolean", category: 1 },
      { name: "Limit category", commentType: "limit", answerType: "boolean", category: -1 },
      { name: "String zero", commentType: "defect", answerType: "boolean", category: 0 },
      { name: "Decimal zero", commentType: "defect", answerType: "boolean", category: 0 },
      { name: "Padded category", commentType: "defect", answerType: "boolean", category: 1 },
      { name: "Dropped category", commentType: "info", answerType: "boolean", category: null },
      { name: "Decoded type", commentType: "info", answerType: "boolean", category: null },
      { name: "Decoded odd type", commentType: "info", answerType: "boolean", category: null },
    ]);

    expect(sourceCell(draft, "Odd defect", COMMENT_TYPE)).toBe(" Defect");
    expect(sourceCell(draft, "String zero", CATEGORY)).toBe("0");
    expect(sourceCell(draft, "Decimal zero", CATEGORY)).toBe("0.0");
    expect(sourceCell(draft, "Padded category", CATEGORY)).toBe(" 1 ");
    expect(sourceCell(draft, "Dropped category", CATEGORY)).toBe("high");
    expect(sourceCell(draft, "Decoded type", COMMENT_TYPE)).toBe("&#105;nfo");
    expect(sourceCell(draft, "Decoded odd type", COMMENT_TYPE)).toBe("&#73;nfo");

    expect(vocabularyIssues(draft, "Odd defect")).toEqual([
      issue(draft, "Odd defect", "vocabulary-normalised", { field: COMMENT_TYPE }),
    ]);
    expect(vocabularyIssues(draft, "Unknown type")).toEqual([issue(draft, "Unknown type", "comment-type-fallback", {})]);
    expect(vocabularyIssues(draft, "Blank type")).toEqual([issue(draft, "Blank type", "comment-type-fallback", {})]);
    expect(vocabularyIssues(draft, "Odd answer")).toEqual([
      issue(draft, "Odd answer", "vocabulary-normalised", { field: ANSWER_TYPE }),
    ]);
    expect(vocabularyIssues(draft, "Unknown answer")).toEqual([issue(draft, "Unknown answer", "answer-type-fallback", {})]);
    expect(vocabularyIssues(draft, "Blank answer")).toEqual([issue(draft, "Blank answer", "answer-type-fallback", {})]);
    expect(vocabularyIssues(draft, "No category")).toEqual([issue(draft, "No category", "category-missing", {})]);
    expect(vocabularyIssues(draft, "Invalid category")).toEqual([issue(draft, "Invalid category", "category-missing", {})]);
    expect(vocabularyIssues(draft, "Info category")).toEqual([
      issue(draft, "Info category", "category-orphan", { category: 1 }),
    ]);
    expect(vocabularyIssues(draft, "Limit category")).toEqual([
      issue(draft, "Limit category", "category-orphan", { category: -1 }),
    ]);
    expect(vocabularyIssues(draft, "String zero")).toEqual([]);
    expect(vocabularyIssues(draft, "Decimal zero")).toEqual([]);
    expect(vocabularyIssues(draft, "Padded category")).toEqual([]);
    expect(vocabularyIssues(draft, "Dropped category")).toEqual([]);
    expect(vocabularyIssues(draft, "Decoded type")).toEqual([]);
    expect(vocabularyIssues(draft, "Decoded odd type")).toEqual([
      issue(draft, "Decoded odd type", "vocabulary-normalised", { field: COMMENT_TYPE }),
    ]);
  });

  it("explains each vocabulary difference only while its issue remains", async () => {
    const draft = await vocabularyDraft();
    expectRoundTrip(draft);

    const result = reconcile(draft, draft.tree);
    expect(categoryDifferences(result.rows, sourceRow(draft, "String zero"))).toEqual([]);
    expect(categoryDifferences(result.rows, sourceRow(draft, "Decimal zero"))).toEqual([]);
    expect(categoryDifferences(result.rows, sourceRow(draft, "Padded category"))).toEqual([]);
    expect(categoryDifferences(result.rows, sourceRow(draft, "Dropped category"))).toEqual([
      {
        column: CATEGORY,
        raw: "high",
        stored: null,
        explanation: { rule: "category-dropped" },
      },
    ]);
    expect(differencesOn(result.rows, sourceRow(draft, "Decoded type"), COMMENT_TYPE)).toEqual([
      {
        column: COMMENT_TYPE,
        raw: "&#105;nfo",
        stored: "info",
        explanation: { rule: "entity-decoding" },
      },
    ]);

    for (const flagged of FLAGGED) {
      const rowNumber = sourceRow(draft, flagged.name);
      expect(differencesOn(result.rows, rowNumber, flagged.difference.column), flagged.name).toContainEqual(flagged.difference);

      const stripped = structuredClone(draft);
      const index = stripped.issues.findIndex((issue) => issue.sourceRow === rowNumber && issue.kind === flagged.kind);
      expect(index, flagged.name).toBeGreaterThanOrEqual(0);
      stripped.issues.splice(index, 1);

      const broken = reconcile(stripped, stripped.tree);
      expect(broken.rows.find((row) => row.sourceRow === rowNumber)?.status, flagged.name).toBe("✗");
      expect(differencesOn(broken.rows, rowNumber, flagged.difference.column), flagged.name).toContainEqual({
        ...flagged.difference,
        explanation: null,
      });
    }
  });

  it("treats Ben's trailing-space Water Supply rows as one Item and records the trim", async () => {
    const draft = await draftOf("Ben Gromicko's Template for Home Inspections-2026-09-30.xls");
    const plumbing = draft.tree.sections.find((section) => section.name === "Plumbing");
    const supplies = plumbing?.items.filter((item) => item.name === "Water Supply") ?? [];
    expect(supplies).toHaveLength(1);
    expect(supplies[0]?.comments.map((comment) => comment.sourceRow)).toEqual([474, 475, 476, 477]);

    const itemColumn = draft.run.headers.indexOf("Item Name");
    expect(draft.sourceRows.find((row) => row.rowNumber === 474)?.cells[itemColumn]).toBe("Water Supply ");

    for (const sourceRow of [474, 475, 476, 477]) {
      expect(draft.issues).toContainEqual({
        kind: "whitespace-trimmed",
        sourceRow,
        detail: { field: "Item Name" },
        cuts: [],
      });
    }
    expect(renderIssueMessage("whitespace-trimmed", { field: "Item Name" })).toBe(
      "Leading and trailing spaces were removed from Item Name.",
    );
  });

  it("trims a padded or blank Recommendation, records the trim and explains it only while the issue remains", async () => {
    const recommendation = "Recommendation (from list)";
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "comment name": "Padded", recommendation: "Masonry-restoration " }),
          rowFor(HEADERS, { "comment name": "Exact", recommendation: "pro" }),
          rowFor(HEADERS, { "comment name": "Spaces only", recommendation: "   " }),
        ]),
        "padded-recommendation.xls",
      ),
    );

    expect(commentOn(draft, sourceRow(draft, "Padded")).recommendation).toBe("Masonry-restoration");
    expect(draft.issues.filter((issue) => issue.sourceRow === sourceRow(draft, "Padded"))).toEqual([
      { kind: "whitespace-trimmed", sourceRow: sourceRow(draft, "Padded"), detail: { field: recommendation }, cuts: [] },
    ]);
    expect(draft.issues.filter((issue) => issue.sourceRow === sourceRow(draft, "Exact"))).toEqual([]);
    expect(commentOn(draft, sourceRow(draft, "Spaces only")).recommendation).toBeNull();
    expect(draft.issues.filter((issue) => issue.sourceRow === sourceRow(draft, "Spaces only"))).toEqual([
      { kind: "whitespace-trimmed", sourceRow: sourceRow(draft, "Spaces only"), detail: { field: recommendation }, cuts: [] },
    ]);
    expectRoundTrip(draft);

    const stripped = structuredClone(draft);
    stripped.issues = stripped.issues.filter((issue) => issue.kind !== "whitespace-trimmed");
    expect(differencesOn(reconcile(stripped, stripped.tree).rows, sourceRow(draft, "Padded"), recommendation)).toEqual([
      { column: recommendation, raw: "Masonry-restoration ", stored: "Masonry-restoration", explanation: null },
    ]);
  });

  it("falls back when the filename is only an extension or only an export date", async () => {
    const bytes = readFixture("Radon Inspection-2026-09-30.xls");
    const untitled = await parseSpectoraExport(bytes, ".xls");
    const dateOnly = await parseSpectoraExport(bytes, "-2026-09-30.xls");
    if (!untitled.ok || !dateOnly.ok) throw new Error("Radon was rejected");
    expect(untitled.draft.suggestedName).toBe("Untitled Template");
    expect(dateOnly.draft.suggestedName).toBe("-2026-09-30");
  });

  it("raises one unsafe-style-removed for a url(, expression( or @import style, and an attribute-removed warning for onerror", async () => {
    const texts = [
      `<p style="background: url(https://evil.test/x)">t</p>`,
      `<p style="background-color: expression(alert(1))">t</p>`,
      `<p style="color: red @import 'x'">t</p>`,
      `<p style="color:u&#114;l(x)">t</p>`,
      `<img src="x" onerror="alert(1)">`,
      `<p style="position: fixed">t</p>`,
    ];
    const draft = expectDraft(await parseSpectoraExport(await workbookWithCommentText(texts), "synthetic.xls"));

    const unsafeRows = [
      { row: 2, property: "background" },
      { row: 3, property: "background-color" },
      { row: 4, property: "color" },
      { row: 5, property: "color" },
    ];
    for (const { row, property } of unsafeRows) {
      const issues = draft.issues.filter((issue) => issue.sourceRow === row && issue.kind === "unsafe-style-removed");
      expect(issues, `row ${row}`).toEqual([
        expect.objectContaining({
          sourceRow: row,
          detail: { tag: "p", property },
        }),
      ]);
      expect(issues[0]?.cuts).toHaveLength(1);
      expect(draft.issues.filter((issue) => issue.sourceRow === row && issue.kind === "editor-leftovers")).toEqual([]);
    }
    expect(renderIssueMessage("unsafe-style-removed", { tag: "p", property: "background" })).toBe(
      "A background style on <p> was removed because its value could load remote content or run code.",
    );
    expect(catalogueEntry("unsafe-style-removed")).toMatchObject({ severity: "warning", class: "Changed" });

    const onerror = draft.issues.filter((issue) => issue.sourceRow === 6 && issue.kind === "attribute-removed");
    expect(onerror).toEqual([expect.objectContaining({ detail: { tag: "img", attribute: "onerror" } })]);
    expect(onerror[0]?.cuts).toHaveLength(1);
    expect(draft.issues.filter((issue) => issue.sourceRow === 6 && issue.kind === "editor-leftovers")).toEqual([]);
    expect(renderIssueMessage("attribute-removed", { tag: "img", attribute: "onerror" })).toBe(
      "The onerror attribute was removed from <img>.",
    );
    expect(catalogueEntry("attribute-removed")).toMatchObject({ severity: "warning", class: "Changed" });

    const routine = draft.issues.filter((issue) => issue.sourceRow === 7);
    expect(routine.map((issue) => issue.kind)).toEqual(["editor-leftovers"]);
    expect(routine[0]).toMatchObject({ detail: { count: 1 } });
    expect(routine[0]?.cuts.map((cut) => cut.kind)).toEqual(["css-property-removed"]);
    expect(catalogueEntry("editor-leftovers")).toMatchObject({ severity: "notice", class: "Changed" });
  });

  it("puts every sanitiser cut on exactly one Import issue for that Comment", async () => {
    for (const fixture of HTML_FIXTURES) {
      const draft = await draftOf(fixture.file);
      const column = draft.run.headers.indexOf("Comment Text");
      expect(
        draft.issues.filter((issue) => issue.kind === "unsafe-style-removed"),
        fixture.file,
      ).toEqual([]);

      const parsed = importDraftSchema.safeParse(draft);
      expect(parsed.success, parsed.success ? fixture.file : JSON.stringify(parsed.error.issues)).toBe(true);

      for (const row of draft.sourceRows) {
        const raw = row.cells[column];
        const text = typeof raw === "string" ? raw : "";
        const cuts = sanitiseCommentHtml(text).cuts;
        const rowIssues = draft.issues.filter((issue) => issue.sourceRow === row.rowNumber);
        const label = `${fixture.file} row ${row.rowNumber}`;

        expect(byStart(rowIssues.flatMap((issue) => issue.cuts)), label).toEqual(byStart(cuts.map(evidenceOf)));

        const bundle = cuts.filter(isBundledCut);
        const leftovers = rowIssues.filter((issue) => issue.kind === "editor-leftovers");
        expect(leftovers, label).toHaveLength(bundle.length === 0 ? 0 : 1);
        if (bundle.length > 0) {
          expect(leftovers[0]?.cuts, label).toEqual(bundle.map(evidenceOf));
          expect(leftovers[0]?.detail, label).toEqual({ count: bundle.length });
        }

        for (const cut of cuts) {
          const owners = rowIssues.filter((issue) =>
            issue.cuts.some((logged) => logged.start === cut.start && logged.end === cut.end && logged.kind === cut.kind),
          );
          expect(owners, `${label} ${cut.kind}@${cut.start}`).toHaveLength(1);
          expect(owners[0]?.kind, `${label} ${cut.kind}@${cut.start}`).toBe(issueKindFor(cut));
          if (!isBundledCut(cut)) expect(owners[0]?.cuts, `${label} ${cut.kind}`).toHaveLength(1);
        }

        for (const issue of rowIssues) {
          if (KINDS_WITHOUT_CUTS.has(issue.kind)) expect(issue.cuts, `${label} ${issue.kind}`).toEqual([]);
          expect(renderIssueMessage(issue.kind, issue.detail).trim().length, `${label} ${issue.kind}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gives each HTML issue kind its severity, class and a message from its detail", () => {
    const rows = [
      ["editor-leftovers", "notice", "Changed", { count: 2 }, "2 editor leftovers were removed from this Comment."],
      ["attribute-removed", "warning", "Changed", { tag: "img", attribute: "onerror" }, "The onerror attribute was removed from <img>."],
      ["tag-unwrapped", "notice", "Changed", { tag: "font" }, "A <font> tag was removed and its text was kept."],
      ["style-unparseable", "notice", "Changed", { tag: "p" }, "A style attribute on <p> could not be parsed and was removed."],
      ["tag-removed", "warning", "Changed", { tag: "script" }, "A <script> tag was removed along with its content."],
      ["link-scheme-removed", "warning", "Changed", { tag: "a" }, "An address on <a> was removed because its scheme is not allowed."],
      ["iframe-to-link", "warning", "Unsupported", {}, "An embedded frame from another site was turned into a link."],
      ["markup-rebuilt", "warning", "Changed", {}, "This Comment's markup was rebuilt. Check it closely."],
      [
        "youtube-wrapper-empty",
        "warning",
        "Missing from export",
        {},
        "An empty YouTube wrapper was removed. The video was not in the export.",
      ],
      [
        "unsafe-style-removed",
        "warning",
        "Changed",
        { tag: "p", property: "background" },
        "A background style on <p> was removed because its value could load remote content or run code.",
      ],
    ] as const;
    for (const [kind, severity, issueClass, detail, message] of rows) {
      expect(catalogueEntry(kind), kind).toMatchObject({ level: "row", severity, class: issueClass });
      expect(renderIssueMessage(kind, detail), kind).toBe(message);
    }
    expect(renderIssueMessage("editor-leftovers", { count: 1 })).toBe("1 editor leftover was removed from this Comment.");
  });

  it("raises each HTML issue kind the fixtures do not contain", async () => {
    const samples = [
      {
        text: '<p>Keep <font color="red">these words</font> here</p>',
        issues: [
          { kind: "tag-unwrapped", detail: { tag: "font" } },
          { kind: "tag-unwrapped", detail: { tag: "font" } },
        ],
      },
      {
        text: '<p style="color: red; font-weight">t</p>',
        issues: [{ kind: "style-unparseable", detail: { tag: "p" } }],
      },
      {
        text: "<script>alert(1)</script>",
        issues: [{ kind: "tag-removed", detail: { tag: "script" } }],
      },
      {
        text: '<a href="javascript:alert(1)">this</a>',
        issues: [{ kind: "link-scheme-removed", detail: { tag: "a" } }],
      },
      {
        text: '<iframe src="https://example.org/page"></iframe>',
        issues: [{ kind: "iframe-to-link", detail: {} }],
      },
      {
        text: `${"<div>".repeat(600)}words`,
        issues: [{ kind: "markup-rebuilt", detail: {} }],
      },
      {
        text: '<div class="youtube-embed-wrapper"></div>',
        issues: [{ kind: "youtube-wrapper-empty", detail: {} }],
      },
    ] as const;

    const draft = expectDraft(
      await parseSpectoraExport(
        await workbookWithCommentText(samples.map((sample) => sample.text)),
        "synthetic.xls",
      ),
    );
    const parsed = importDraftSchema.safeParse(draft);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);

    for (const [index, sample] of samples.entries()) {
      const sourceRow = index + 2;
      const label = sample.issues[0]?.kind ?? `row ${sourceRow}`;
      const issues = draft.issues.filter((issue) => issue.sourceRow === sourceRow);
      expect(
        issues.map((issue) => ({ kind: issue.kind, detail: issue.detail })),
        label,
      ).toEqual(sample.issues);
      for (const issue of issues) {
        expect(issue.cuts, label).toHaveLength(1);
        expect(renderIssueMessage(issue.kind, issue.detail).trim().length, label).toBeGreaterThan(0);
      }
    }
  });

  it("rejects 5 MB of zeros as too-large, before any other check, and names the size and the limit", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024);
    const result = await parseSpectoraExport(bytes, "zeros.xls");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toEqual({ kind: "too-large", byteSize: bytes.byteLength, limit: MAX_UPLOAD_BYTES });
    expect(MAX_UPLOAD_BYTES).toBe(4_194_304);
    expect(rejectionMessage(result.rejection)).toBe(
      "This file is 5.0 MB, which is over the 4.0 MB limit.",
    );
  });

  it("rejects an oversized PDF as too-large rather than as not a spreadsheet", async () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    bytes.set(new TextEncoder().encode("%PDF-1.7"));
    const result = await parseSpectoraExport(bytes, "big.pdf");
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "too-large", byteSize: bytes.byteLength, limit: MAX_UPLOAD_BYTES },
    });
  });

  it("rejects the plain-text fixture and imports a workbook with no tags and no ampersand", async () => {
    const file = "InterNACHI Residential -2026-09-30 (plain text).xls";
    const rejected = await parseSpectoraExport(readFixture(file), file);
    expect(rejected).toEqual({ ok: false, rejection: { kind: "plain-text-export" } });
    expect(rejectionMessage({ kind: "plain-text-export" })).toBe(
      "This is Spectora's plain-text export. It has lost all formatting and link URLs. Re-export with … Export HTML Text.",
    );

    const row = HEADERS.map(() => "");
    row[0] = "Roof";
    row[1] = "Covering";
    row[2] = "Shingles";
    row[HEADERS.indexOf("Comment Text")] = "No formatting here.";
    row[HEADERS.indexOf("Comment Type (info, limit, defect)")] = "info";
    row[HEADERS.indexOf("Answer Type (boolean, checkbox, date, number, range, text)")] = "boolean";
    const imported = expectDraft(await parseSpectoraExport(await writeXlsxFile([HEADERS, row]).toBuffer(), "plain.xls"));
    const comment = imported.tree.sections[0]?.items[0]?.comments[0];
    expect(imported.tree.sections.map((section) => section.name)).toEqual(["Roof"]);
    expect(imported.tree.sections[0]?.items.map((item) => item.name)).toEqual(["Covering"]);
    expect(comment).toMatchObject({ name: "Shingles", textHtml: "No formatting here." });
  });

  it("imports a tagless workbook whose only ampersands start character references, including &#X", async () => {
    const row = HEADERS.map(() => "");
    row[0] = "Doors &#x26; Windows";
    row[1] = "Trim &amp; casing";
    row[2] = "E &#38; F";
    row[HEADERS.indexOf("Comment Text")] = "Price &#X41; each";
    row[HEADERS.indexOf("Comment Type (info, limit, defect)")] = "info";
    const draft = expectDraft(await parseSpectoraExport(await writeXlsxFile([HEADERS, row]).toBuffer(), "entities.xls"));
    expect(draft.tree.sections[0]?.items[0]?.comments[0]?.textHtml).toBe("Price &#X41; each");
  });

  it("rejects plain text when an optional column is missing, and names a missing required column first", async () => {
    const headers = ["Section Name", "Item Name", "Comment Name", "Comment Text", "Comment Type (info, limit, defect)"];
    const plain = ["Roof", "Covering", "Shingles & Flashing", "No formatting here.", "info"];
    const rejected = await parseSpectoraExport(await writeXlsxFile([headers, plain]).toBuffer(), "plain-no-category.xls");
    expect(rejected).toEqual({ ok: false, rejection: { kind: "plain-text-export" } });

    const missingItem = ["Section Name", "Comment Name", "Comment Text", "Comment Type (info, limit, defect)"];
    const row = ["Roof & Gutters", "Shingles", "No formatting here.", "info"];
    const result = await parseSpectoraExport(await writeXlsxFile([missingItem, row]).toBuffer(), "missing-item.xls");
    expect(result).toEqual({ ok: false, rejection: { kind: "missing-columns", missing: ["Item Name"] } });
  });

  it("rejects a workbook missing Comment Type and Item Name and names both", async () => {
    const headers = HEADERS.filter(
      (header) => header !== "Item Name" && header !== "Comment Type (info, limit, defect)",
    );
    const row = headers.map(() => "");
    row[headers.indexOf("Section Name")] = "Roof";
    row[headers.indexOf("Comment Name")] = "Shingles";
    row[headers.indexOf("Comment Text")] = "<p>Checked</p>";
    const bytes = await writeXlsxFile([headers, row]).toBuffer();
    const result = await parseSpectoraExport(bytes, "missing.xls");
    expect(result).toEqual({
      ok: false,
      rejection: { kind: "missing-columns", missing: ["Item Name", "Comment Type"] },
    });
    expect(rejectionMessage({ kind: "missing-columns", missing: ["Item Name", "Comment Type"] })).toBe(
      "This export is missing Item Name and Comment Type.",
    );
  });

  it("rejects a header-only workbook and a sheet of blank rows as having no comments", async () => {
    const headerOnly = await writeXlsxFile([HEADERS]).toBuffer();
    const blanks = await writeXlsxFile([HEADERS, HEADERS.map(() => " "), HEADERS.map(() => "\u00A0")]).toBuffer();
    for (const bytes of [headerOnly, blanks]) {
      const result = await parseSpectoraExport(bytes, "empty.xls");
      expect(result).toEqual({ ok: false, rejection: { kind: "no-data-rows" } });
    }
    expect(rejectionMessage({ kind: "no-data-rows" })).toBe("This export has no comments.");
  });

  it("rejects a truncated zip as an unreadable spreadsheet", async () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const result = await parseSpectoraExport(bytes, "broken.xlsx");
    expect(result).toEqual({ ok: false, rejection: { kind: "unreadable-xlsx" } });
    expect(rejectionMessage({ kind: "unreadable-xlsx" })).toBe(
      "This spreadsheet couldn't be read. In Spectora: Template → ⋮ → Export to spreadsheet → Export HTML Text.",
    );
  });

  it.each([
    ["a PDF", new TextEncoder().encode("%PDF-1.7\n")],
    ["a legacy .xls workbook", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["a CSV", new TextEncoder().encode("Section Name,Item Name\nRoof,Shingles\n")],
  ])("rejects %s as not a Spectora spreadsheet", async (_label, bytes) => {
    const result = await parseSpectoraExport(bytes, "upload.bin");
    expect(result).toEqual({ ok: false, rejection: { kind: "not-xlsx" } });
    expect(rejectionMessage({ kind: "not-xlsx" })).toBe(
      "This isn't a Spectora spreadsheet export. In Spectora: Template → ⋮ → Export to spreadsheet → Export HTML Text.",
    );
  });

  it("imports reordered columns by header", async () => {
    const headers = [...HEADERS].reverse();
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(headers, [rowFor(headers, { "comment name": "Cracking", "comment type": "defect", "answer type": "checkbox" })]),
        "reordered.xls",
      ),
    );

    expect(draft.tree.sections[0]?.items[0]?.comments[0]).toMatchObject({
      name: "Cracking",
      commentType: "defect",
      answerType: "checkbox",
    });
    expect(fileShapeIssues(draft)).toEqual([]);
    expectRoundTrip(draft);
  });

  it("imports headers in odd case and with padding", async () => {
    const headers = HEADERS.map((header) => `  ${header.toUpperCase()}  `);
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(headers, [rowFor(headers, { "recommendation": "pro &amp; crew", "comment type": "defect" })]),
        "odd-case.xls",
      ),
    );

    const comment = draft.tree.sections[0]?.items[0]?.comments[0];
    expect(comment).toMatchObject({ commentType: "defect", recommendation: "pro & crew" });
    expect(fileShapeIssues(draft)).toEqual([]);
    const recommendation = draft.run.headers.findIndex((header) => headerKey(header) === "recommendation");
    expect(toExportRows(draft.tree, draft)[0]?.cells[recommendation]).toBe("pro & crew");
    expectRoundTrip(draft);
  });

  it("imports short headers without the parenthetical hint", async () => {
    const headers = HEADERS.map(withoutHint);
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(headers, [
          rowFor(headers, {
            "comment type": "defect",
            "answer type": "text",
            recommendation: "pro &amp; crew",
            category: 1,
          }),
        ]),
        "short-headers.xls",
      ),
    );

    expect(draft.tree.sections[0]?.items[0]?.comments[0]).toMatchObject({
      commentType: "defect",
      answerType: "text",
      recommendation: "pro & crew",
      category: 1,
    });
    expect(fileShapeIssues(draft)).toEqual([]);
    const recommendation = headers.indexOf("Recommendation");
    expect(toExportRows(draft.tree, draft)[0]?.cells[recommendation]).toBe("pro & crew");
    expectRoundTrip(draft);
  });

  it("keeps an unknown extra column in the Source row and flags it", async () => {
    const headers = [...HEADERS, "Inspector Notes", "Site Code"];
    const row = rowFor(headers, { "Inspector Notes": "kept raw", "Site Code": "north" });
    const draft = expectDraft(await parseSpectoraExport(await workbook(headers, [row]), "extra-column.xls"));

    expect(draft.issues.filter((issue) => issue.kind === "unknown-column")).toEqual([
      {
        kind: "unknown-column",
        sourceRow: null,
        detail: { header: "Inspector Notes", column: HEADERS.length + 1 },
        cuts: [],
      },
      {
        kind: "unknown-column",
        sourceRow: null,
        detail: { header: "Site Code", column: HEADERS.length + 2 },
        cuts: [],
      },
    ]);
    expect(draft.sourceRows[0]?.cells.slice(-2)).toEqual(["kept raw", "north"]);
    expect(draft.tree.sections[0]?.items[0]?.name).toBe("Covering");
    expectRoundTrip(draft);
  });

  it("flags a blank header over values and ignores a blank header over an empty column", async () => {
    const headers = [...HEADERS];
    headers.splice(1, 0, "", "");
    const row = rowFor(headers);
    row[1] = "secret";
    const draft = expectDraft(await parseSpectoraExport(await workbook(headers, [row]), "blank-header.xls"));

    expect(draft.run.headers[1]).toBe("");
    expect(draft.run.headers[2]).toBe("");
    expect(draft.sourceRows[0]?.cells[1]).toBe("secret");
    expect(draft.issues.filter((issue) => issue.kind === "unknown-column")).toEqual([
      { kind: "unknown-column", sourceRow: null, detail: { header: "", column: 2 }, cuts: [] },
    ]);
    expect(draft.tree.sections[0]?.items[0]?.name).toBe("Covering");
    expectRoundTrip(draft);
  });

  it("uses the first column when a header is duplicated", async () => {
    const headers = [...HEADERS];
    headers.splice(2, 0, "Item Name");
    const row = rowFor(headers);
    row[2] = "Not the item";
    const draft = expectDraft(await parseSpectoraExport(await workbook(headers, [row]), "duplicate-header.xls"));

    expect(draft.tree.sections[0]?.items[0]?.name).toBe("Covering");
    expect(draft.sourceRows[0]?.cells[2]).toBe("Not the item");
    expect(draft.issues.filter((issue) => issue.kind === "unknown-column")).toEqual([
      { kind: "unknown-column", sourceRow: null, detail: { header: "Item Name", column: 3 }, cuts: [] },
    ]);
    expect(draft.issues.filter((issue) => issue.kind === "expected-column-missing")).toEqual([]);
    expectRoundTrip(draft);
  });

  it("imports a missing optional column as empty and flags it", async () => {
    const headers = HEADERS.filter((header) => header !== "Category (-1: Low, 0: Med, 1: High)");
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(headers, [
          rowFor(headers, { "comment type": "defect", "answer type": "checkbox", "multiple choice options": "wood, metal" }),
        ]),
        "missing-category.xls",
      ),
    );

    expect(draft.tree.sections[0]?.items[0]?.comments[0]).toMatchObject({
      commentType: "defect",
      category: null,
      answerType: "checkbox",
      choiceOptions: ["wood", "metal"],
    });
    expect(draft.issues.filter((issue) => issue.kind === "expected-column-missing")).toEqual([
      { kind: "expected-column-missing", sourceRow: null, detail: { column: "Category" }, cuts: [] },
    ]);
    expectRoundTrip(draft);
  });

  it("flags sheets after the first and does not import them", async () => {
    const bytes = await writeXlsxFile([
      { data: [HEADERS, rowFor(HEADERS, { "comment name": "On the first sheet" })], sheet: "Sheet1" },
      { data: [HEADERS, rowFor(HEADERS, { "comment name": "On the notes sheet" })], sheet: "Notes" },
      { data: [["left behind"]], sheet: "Photos" },
    ]).toBuffer();
    const draft = expectDraft(await parseSpectoraExport(bytes, "extra-sheet.xls"));

    expect(draft.run.sheetName).toBe("Sheet1");
    expect(draft.tree.sections[0]?.items[0]?.comments.map((comment) => comment.name)).toEqual(["On the first sheet"]);
    expect(draft.issues.filter((issue) => issue.kind === "extra-sheet")).toEqual([
      { kind: "extra-sheet", sourceRow: null, detail: { sheets: ["Notes", "Photos"] }, cuts: [] },
    ]);
    expectRoundTrip(draft);
  });

  it("skips blank rows, counts them, and keeps the sheet's row numbers", async () => {
    const blank = HEADERS.map(() => "");
    const padding = HEADERS.map(() => "\u00A0");
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "comment name": "First" }),
          blank,
          padding,
          rowFor(HEADERS, { "comment name": "Second" }),
        ]),
        "blank-rows.xls",
      ),
    );

    expect(draft.run.rowsRead).toBe(4);
    expect(draft.run.blankRows).toBe(2);
    expect(draft.sourceRows.map((row) => row.rowNumber)).toEqual([2, 5]);
    expect(draft.tree.sections[0]?.items[0]?.comments.map((comment) => comment.name)).toEqual(["First", "Second"]);
    expect(fileShapeIssues(draft)).toEqual([]);
    expectRoundTrip(draft);
  });

  it("describes the file-shape issue kinds", () => {
    expect(catalogueEntry("expected-column-missing")).toMatchObject({
      level: "file",
      severity: "warning",
      class: "Missing from export",
      title: "Expected column missing",
    });
    expect(renderIssueMessage("expected-column-missing", { column: "Category" })).toBe(
      "Category wasn't in this export, so it was left empty.",
    );

    expect(catalogueEntry("unknown-column")).toMatchObject({
      level: "file",
      severity: "notice",
      class: "Unsupported",
      title: "Unknown column",
    });
    expect(renderIssueMessage("unknown-column", { header: "Inspector Notes", column: 43 })).toBe(
      'Column 43 ("Inspector Notes") wasn\'t used. Its cells were kept in the Source row.',
    );
    expect(renderIssueMessage("unknown-column", { header: "", column: 2 })).toBe(
      "Column 2 has no header. Its cells were kept in the Source row.",
    );

    expect(catalogueEntry("extra-sheet")).toMatchObject({
      level: "file",
      severity: "warning",
      class: "Unsupported",
      title: "Extra sheet",
    });
    expect(renderIssueMessage("extra-sheet", { sheets: ["Notes"] })).toBe(
      'The sheet "Notes" wasn\'t read. Only the first sheet was imported.',
    );
    expect(renderIssueMessage("extra-sheet", { sheets: ["Notes", "Photos"] })).toBe(
      'The sheets "Notes" and "Photos" weren\'t read. Only the first sheet was imported.',
    );
    expect(renderIssueMessage("extra-sheet", { sheets: ["Notes", "Photos", "Appendix"] })).toBe(
      'The sheets "Notes", "Photos" and "Appendix" weren\'t read. Only the first sheet was imported.',
    );
  });

  it("does not flag the shape of a real Spectora export", async () => {
    for (const fixture of HTML_FIXTURES) {
      const draft = await draftOf(fixture.file);
      expect(fileShapeIssues(draft), fixture.file).toEqual([]);
    }
  });

  it("flags Spectora's stock estimate on every fixture, and groups Ben's default photos", async () => {
    const ben = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";
    const residentialTemplate = "Residential Template-2026-09-30.xls";
    const rawOnlyByFile: Record<string, { column: string; rows: number[] }[]> = {
      [ben]: [
        {
          column: "Default Location",
          rows: [315, 321, 357, 656, 859, 869, 1131, 1140, 1142, 1150, 1171],
        },
        {
          column: "Default photos",
          rows: [38, 39, 213, 214, 217, 251, 351, 614, 619, 688, 837, 839, 847, 862, 974, 975, 978, 1128],
        },
      ],
      [residentialTemplate]: [{ column: "Default Location", rows: [4] }],
    };

    for (const fixture of HTML_FIXTURES) {
      const draft = await draftOf(fixture.file);
      expect(draft.issues.filter((issue) => issue.kind === "stock-estimates"), fixture.file).toEqual([
        { kind: "stock-estimates", sourceRow: null, detail: { count: fixture.rows }, cuts: [] },
      ]);
      expect(draft.issues.filter((issue) => issue.kind === "custom-estimates"), fixture.file).toEqual([]);
      expect(draft.issues.filter((issue) => issue.kind === "raw-only-content"), fixture.file).toEqual(
        (rawOnlyByFile[fixture.file] ?? []).map((detail) => ({
          kind: "raw-only-content",
          sourceRow: null,
          detail,
          cuts: [],
        })),
      );
    }

    expect(renderIssueMessage("stock-estimates", { count: 392 })).toBe(
      "Spectora's stock estimate on all 392 Comments; not imported.",
    );
    expect(renderIssueMessage("stock-estimates", { count: 1 })).toBe(
      "Spectora's stock estimate on 1 Comment; not imported.",
    );
    expect(
      renderIssueMessage("raw-only-content", {
        column: "Default photos",
        rows: [38, 39, 213, 214, 217, 251, 351, 614, 619, 688, 837, 839, 847, 862, 974, 975, 978, 1128],
      }),
    ).toBe("18 Comments have default photos; kept in the Source row, not shown in the editor.");
    expect(renderIssueMessage("raw-only-content", { column: "Default Location", rows: [4] })).toBe(
      "Default Location has content on row 4; kept in the Source row, not shown in the editor.",
    );
    expect(catalogueEntry("raw-only-content")).toMatchObject({
      level: "file",
      severity: "notice",
      class: "Unsupported",
      title: "Raw-only content",
    });
    expect(catalogueEntry("stock-estimates")).toMatchObject({
      level: "file",
      severity: "notice",
      class: "Unsupported",
      title: "Stock estimates",
    });
    expect(catalogueEntry("custom-estimates")).toMatchObject({
      level: "file",
      severity: "warning",
      class: "Unsupported",
      title: "Custom estimates",
    });
  });

  it("warns on custom estimates and does not also call the file stock", async () => {
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "comment name": "Stock", "default estimate min": "10", "default estimate max": "1000" }),
          rowFor(HEADERS, { "comment name": "Blank" }),
          rowFor(HEADERS, { "comment name": "Custom", "default estimate min": 25, "default estimate max": "400" }),
          rowFor(HEADERS, { "comment name": "Min only", "default estimate min": 10 }),
        ]),
        "custom-estimates.xls",
      ),
    );

    expect(draft.issues.filter((issue) => issue.kind === "custom-estimates")).toEqual([
      { kind: "custom-estimates", sourceRow: null, detail: { rows: [4] }, cuts: [] },
    ]);
    expect(draft.issues.filter((issue) => issue.kind === "stock-estimates")).toEqual([]);
    expect(renderIssueMessage("custom-estimates", { rows: [4] })).toBe(
      "A custom estimate on row 4 was kept in the Source row, not shown in the editor.",
    );
    expect(renderIssueMessage("custom-estimates", { rows: [4, 8, 9] })).toBe(
      "Custom estimates on rows 4, 8 and 9 were kept in the Source row, not shown in the editor.",
    );
    expectRoundTrip(draft);
  });

  it("groups default photos into one notice and leaves Order, Uses and Last Modified alone", async () => {
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, {
            "comment name": "Photo",
            "Default Photo 1": "https://cdn.spectora.com/default_photos/a.jpg",
            Uses: 0,
            "order": 5,
            "last modified": "09/30/2026 03:42:57",
          }),
          rowFor(HEADERS, {
            "comment name": "Caption",
            "Default Photo 2 Caption": "Front",
            "default value 2": "5-10",
          }),
          rowFor(HEADERS, { "comment name": "Counter", Uses: 3 }),
        ]),
        "default-photos.xls",
      ),
    );

    expect(draft.issues.filter((issue) => issue.kind === "raw-only-content")).toEqual([
      {
        kind: "raw-only-content",
        sourceRow: null,
        detail: { column: "Default Value 2", rows: [3] },
        cuts: [],
      },
      {
        kind: "raw-only-content",
        sourceRow: null,
        detail: { column: "Uses", rows: [4] },
        cuts: [],
      },
      {
        kind: "raw-only-content",
        sourceRow: null,
        detail: { column: "Default photos", rows: [2, 3] },
        cuts: [],
      },
    ]);
    expect(renderIssueMessage("raw-only-content", { column: "Default photos", rows: [2] })).toBe(
      "1 Comment has default photos; kept in the Source row, not shown in the editor.",
    );
    expect(renderIssueMessage("raw-only-content", { column: "Uses", rows: [4, 9] })).toBe(
      "Uses has content on rows 4 and 9; kept in the Source row, not shown in the editor.",
    );
    expectRoundTrip(draft);
  });

  it("raises no estimate issue when the estimate columns are missing or blank", async () => {
    const headers = HEADERS.filter((header) => header !== "Default Estimate Min" && header !== "Default Estimate Max");
    const missing = expectDraft(
      await parseSpectoraExport(
        await workbook(headers, [rowFor(headers, { "comment name": "No estimates" })]),
        "no-estimate-columns.xls",
      ),
    );
    expect(missing.issues.filter((issue) => issue.kind === "stock-estimates" || issue.kind === "custom-estimates")).toEqual(
      [],
    );
    expectRoundTrip(missing);

    const blank = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "comment name": "Empty" }),
          rowFor(HEADERS, { "comment name": "Also empty", "default estimate min": "  ", "default estimate max": null }),
        ]),
        "blank-estimates.xls",
      ),
    );
    expect(blank.issues.filter((issue) => issue.kind === "stock-estimates" || issue.kind === "custom-estimates")).toEqual(
      [],
    );
    expectRoundTrip(blank);

    const stockAndBlank = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "comment name": "Stock", "default estimate min": 10, "default estimate max": 1000 }),
          rowFor(HEADERS, { "comment name": "Empty" }),
        ]),
        "partial-stock.xls",
      ),
    );
    expect(stockAndBlank.issues.filter((issue) => issue.kind === "stock-estimates")).toEqual([
      { kind: "stock-estimates", sourceRow: null, detail: { count: 1 }, cuts: [] },
    ]);
    expect(stockAndBlank.issues.filter((issue) => issue.kind === "custom-estimates")).toEqual([]);
    expectRoundTrip(stockAndBlank);
  });

  it("keeps an Item name that recurs under different Sections as separate Items", async () => {
    const draft = await draftOf("Room-by-Room Residential Template-2026-09-30.xls");
    const master = draft.tree.sections.find((section) => section.name === "Master Bedroom");
    const bedroom2 = draft.tree.sections.find((section) => section.name === "Bedroom 2");
    const masterDoors = master?.items.find((item) => item.name === "Doors");
    const bedroomDoors = bedroom2?.items.find((item) => item.name === "Doors");
    expect(masterDoors?.comments.length).toBeGreaterThan(0);
    expect(bedroomDoors?.comments.length).toBeGreaterThan(0);
    expect(masterDoors?.comments[0]?.sourceRow).not.toBe(bedroomDoors?.comments[0]?.sourceRow);
  });

  it("keeps Ben's duplicate Comments and flags every one after the first", async () => {
    const draft = await draftOf("Ben Gromicko's Template for Home Inspections-2026-09-30.xls");
    expect(commentOn(draft, 306)).toMatchObject({
      name: "Missing GFCI in Unfinished Basement",
      commentType: "defect",
    });
    expect(commentOn(draft, 308)).toMatchObject({
      name: "Missing GFCI in Unfinished Basement",
      commentType: "defect",
    });

    const flagged = draft.issues.filter(
      (entry) => entry.kind === "duplicate-comment" && (entry.sourceRow === 306 || entry.sourceRow === 308),
    );
    expect(flagged).toEqual([
      {
        kind: "duplicate-comment",
        sourceRow: 308,
        detail: {
          name: "Missing GFCI in Unfinished Basement",
          commentType: "defect",
          rows: [306, 308],
        },
        cuts: [],
      },
    ]);
    expect(catalogueEntry("duplicate-comment")).toMatchObject({
      level: "row",
      severity: "notice",
      class: "Check",
      title: "Duplicate comment",
    });
    expect(
      renderIssueMessage("duplicate-comment", {
        name: "Missing GFCI in Unfinished Basement",
        commentType: "defect",
        rows: [306, 308],
      }),
    ).toBe(
      '"Missing GFCI in Unfinished Basement" (Deficiency) is repeated on rows 306 and 308. Each one was kept.',
    );
    expect(
      renderIssueMessage("duplicate-comment", {
        name: "Crack",
        commentType: "info",
        rows: [2, 5, 6],
      }),
    ).toBe('"Crack" (Informational) is repeated on rows 2, 5 and 6. Each one was kept.');
  });

  it("imports every fixture with no split run", async () => {
    for (const fixture of HTML_FIXTURES) {
      const draft = await draftOf(fixture.file);
      expect(
        draft.issues.filter((entry) => entry.kind === "split-run"),
        fixture.file,
      ).toEqual([]);
    }
  });

  it("imports a split Section run and a split Item run separately, and explains each only while its issue remains", async () => {
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "section name": "Roof", "item name": "Covering", "comment name": "Shingles", "comment type": "defect" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Covering", "comment name": "Shingles", "comment type": "info" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Covering", "comment name": "Shingles", "comment type": "defect" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Flashing", "comment name": "Drip edge", "comment type": "info" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Covering", "comment name": "Shingles", "comment type": "defect" }),
          rowFor(HEADERS, { "section name": "Plumbing", "item name": "Supply", "comment name": "Pipe", "comment type": "info" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Gutters", "comment name": "Guards", "comment type": "info" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Gutters", "comment name": "Screens", "comment type": "info" }),
          rowFor(HEADERS, { "section name": "Electrical", "item name": "Panel", "comment name": "Breaker", "comment type": "info" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Decking", "comment name": "Moss", "comment type": "info" }),
        ]),
        "splits.xls",
      ),
    );

    expect(outline(draft)).toEqual([
      {
        name: "Roof",
        items: [
          {
            name: "Covering",
            comments: [
              { row: 2, name: "Shingles", commentType: "defect" },
              { row: 3, name: "Shingles", commentType: "info" },
              { row: 4, name: "Shingles", commentType: "defect" },
            ],
          },
          { name: "Flashing", comments: [{ row: 5, name: "Drip edge", commentType: "info" }] },
          { name: "Covering", comments: [{ row: 6, name: "Shingles", commentType: "defect" }] },
        ],
      },
      { name: "Plumbing", items: [{ name: "Supply", comments: [{ row: 7, name: "Pipe", commentType: "info" }] }] },
      {
        name: "Roof",
        items: [
          {
            name: "Gutters",
            comments: [
              { row: 8, name: "Guards", commentType: "info" },
              { row: 9, name: "Screens", commentType: "info" },
            ],
          },
        ],
      },
      { name: "Electrical", items: [{ name: "Panel", comments: [{ row: 10, name: "Breaker", commentType: "info" }] }] },
      { name: "Roof", items: [{ name: "Decking", comments: [{ row: 11, name: "Moss", commentType: "info" }] }] },
    ]);

    expect(draft.issues.filter((entry) => entry.kind === "split-run")).toEqual([
      {
        kind: "split-run",
        sourceRow: 6,
        detail: {
          level: "item",
          name: "Covering",
          firstRow: 6,
          lastRow: 6,
          earlierRuns: [{ firstRow: 2, lastRow: 4 }],
        },
        cuts: [],
      },
      {
        kind: "split-run",
        sourceRow: 8,
        detail: {
          level: "section",
          name: "Roof",
          firstRow: 8,
          lastRow: 9,
          earlierRuns: [{ firstRow: 2, lastRow: 6 }],
        },
        cuts: [],
      },
      {
        kind: "split-run",
        sourceRow: 11,
        detail: {
          level: "section",
          name: "Roof",
          firstRow: 11,
          lastRow: 11,
          earlierRuns: [
            { firstRow: 2, lastRow: 6 },
            { firstRow: 8, lastRow: 9 },
          ],
        },
        cuts: [],
      },
    ]);
    expect(draft.issues.filter((entry) => entry.kind === "duplicate-comment")).toEqual([
      {
        kind: "duplicate-comment",
        sourceRow: 4,
        detail: { name: "Shingles", commentType: "defect", rows: [2, 4] },
        cuts: [],
      },
    ]);
    expect(catalogueEntry("split-run")).toMatchObject({
      level: "row",
      severity: "warning",
      class: "Check",
      title: "Split run",
    });
    expect(
      renderIssueMessage("split-run", {
        level: "item",
        name: "Covering",
        firstRow: 6,
        lastRow: 6,
        earlierRuns: [{ firstRow: 2, lastRow: 4 }],
      }),
    ).toBe('"Covering" appears again as its own Item (row 6). An earlier run is rows 2-4.');
    expect(
      renderIssueMessage("split-run", {
        level: "section",
        name: "Roof",
        firstRow: 11,
        lastRow: 11,
        earlierRuns: [
          { firstRow: 2, lastRow: 6 },
          { firstRow: 8, lastRow: 9 },
        ],
      }),
    ).toBe('"Roof" appears again as its own Section (row 11). Earlier runs are rows 2-6 and rows 8-9.');

    expectRoundTrip(draft);
    const explained = reconcile(draft, draft.tree);
    expect(differencesOn(explained.rows, 6, "Split run")).toEqual([
      { column: "Split run", raw: "item", stored: "Covering", explanation: { issues: ["split-run"] } },
    ]);
    expect(differencesOn(explained.rows, 11, "Split run")).toEqual([
      { column: "Split run", raw: "section", stored: "Roof", explanation: { issues: ["split-run"] } },
    ]);

    for (const sourceRow of [6, 8, 11]) {
      const stripped = withoutIssue(draft, sourceRow, "split-run");
      const broken = reconcile(stripped, stripped.tree);
      expect(broken.rows.find((row) => row.sourceRow === sourceRow)?.status, `row ${sourceRow}`).toBe("✗");
      expect(differencesOn(broken.rows, sourceRow, "Split run"), `row ${sourceRow}`).toEqual([
        {
          column: "Split run",
          raw: sourceRow === 6 ? "item" : "section",
          stored: sourceRow === 6 ? "Covering" : "Roof",
          explanation: null,
        },
      ]);
    }
  });

  it("does not treat the same Item name under two Sections as a split run or a duplicate", async () => {
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "section name": "Master Bedroom", "item name": "Doors", "comment name": "Latch" }),
          rowFor(HEADERS, { "section name": "Bedroom 2", "item name": "Doors", "comment name": "Latch" }),
        ]),
        "repeated-item.xls",
      ),
    );

    expect(outline(draft)).toEqual([
      { name: "Master Bedroom", items: [{ name: "Doors", comments: [{ row: 2, name: "Latch", commentType: "info" }] }] },
      { name: "Bedroom 2", items: [{ name: "Doors", comments: [{ row: 3, name: "Latch", commentType: "info" }] }] },
    ]);
    expect(draft.issues.filter((entry) => entry.kind === "split-run" || entry.kind === "duplicate-comment")).toEqual([]);
    expectRoundTrip(draft);
  });

  it("stores a blank name as Untitled, groups consecutive blanks, and explains that only with blank-name", async () => {
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "section name": null, "item name": null, "comment name": null }),
          rowFor(HEADERS, {
            "section name": "  ",
            "item name": " \u00A0 ",
            "comment name": "  ",
            "comment type": "limit",
          }),
          rowFor(HEADERS, { "section name": "Roof", "item name": null, "comment name": "Named" }),
          rowFor(HEADERS, { "section name": "Roof", "item name": "Covering", "comment name": null }),
          rowFor(HEADERS, { "section name": "Roof", "item name": " \u00A0", "comment name": "Later" }),
          rowFor(HEADERS, { "section name": null, "item name": "Doors", "comment name": "After" }),
        ]),
        "blank-names.xls",
      ),
    );

    expect(outline(draft)).toEqual([
      {
        name: "Untitled Section",
        items: [
          {
            name: "Untitled Item",
            comments: [
              { row: 2, name: "Untitled Comment", commentType: "info" },
              { row: 3, name: "Untitled Comment", commentType: "limit" },
            ],
          },
        ],
      },
      {
        name: "Roof",
        items: [
          { name: "Untitled Item", comments: [{ row: 4, name: "Named", commentType: "info" }] },
          { name: "Covering", comments: [{ row: 5, name: "Untitled Comment", commentType: "info" }] },
          { name: "Untitled Item", comments: [{ row: 6, name: "Later", commentType: "info" }] },
        ],
      },
      { name: "Untitled Section", items: [{ name: "Doors", comments: [{ row: 7, name: "After", commentType: "info" }] }] },
    ]);

    expect(draft.issues.filter((entry) => entry.kind === "blank-name")).toEqual([
      { kind: "blank-name", sourceRow: 2, detail: { field: "Section Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 2, detail: { field: "Item Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 2, detail: { field: "Comment Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 3, detail: { field: "Section Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 3, detail: { field: "Item Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 3, detail: { field: "Comment Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 4, detail: { field: "Item Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 5, detail: { field: "Comment Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 6, detail: { field: "Item Name" }, cuts: [] },
      { kind: "blank-name", sourceRow: 7, detail: { field: "Section Name" }, cuts: [] },
    ]);
    expect(
      draft.issues.filter(
        (entry) => entry.kind === "whitespace-trimmed" && ["Section Name", "Item Name", "Comment Name"].includes(detailField(entry.detail) ?? ""),
      ),
    ).toEqual([]);
    expect(draft.issues.filter((entry) => entry.kind === "split-run")).toEqual([
      {
        kind: "split-run",
        sourceRow: 6,
        detail: {
          level: "item",
          name: "Untitled Item",
          firstRow: 6,
          lastRow: 6,
          earlierRuns: [{ firstRow: 4, lastRow: 4 }],
        },
        cuts: [],
      },
      {
        kind: "split-run",
        sourceRow: 7,
        detail: {
          level: "section",
          name: "Untitled Section",
          firstRow: 7,
          lastRow: 7,
          earlierRuns: [{ firstRow: 2, lastRow: 3 }],
        },
        cuts: [],
      },
    ]);
    expect(catalogueEntry("blank-name")).toMatchObject({
      level: "row",
      severity: "warning",
      class: "Changed",
      title: "Blank name",
    });
    expect(renderIssueMessage("blank-name", { field: "Section Name" })).toBe(
      "Section Name was blank, so it was stored as Untitled Section.",
    );
    expect(renderIssueMessage("blank-name", { field: "Item Name" })).toBe(
      "Item Name was blank, so it was stored as Untitled Item.",
    );
    expect(renderIssueMessage("blank-name", { field: "Comment Name" })).toBe(
      "Comment Name was blank, so it was stored as Untitled Comment.",
    );

    expectRoundTrip(draft);
    const explained = reconcile(draft, draft.tree);
    expect(differencesOn(explained.rows, 2, "Section Name")).toEqual([
      { column: "Section Name", raw: null, stored: "Untitled Section", explanation: { issues: ["blank-name"] } },
    ]);
    expect(differencesOn(explained.rows, 3, "Item Name")).toEqual([
      { column: "Item Name", raw: " \u00A0 ", stored: "Untitled Item", explanation: { issues: ["blank-name"] } },
    ]);
    expect(differencesOn(explained.rows, 6, "Split run")).toEqual([
      { column: "Split run", raw: "item", stored: "Untitled Item", explanation: { issues: ["split-run"] } },
    ]);

    const stripped = structuredClone(draft);
    stripped.issues = stripped.issues.filter(
      (entry) => !(entry.kind === "blank-name" && entry.sourceRow === 2 && detailField(entry.detail) === "Section Name"),
    );
    const broken = reconcile(stripped, stripped.tree);
    expect(broken.rows.find((row) => row.sourceRow === 2)?.status).toBe("✗");
    expect(differencesOn(broken.rows, 2, "Section Name")).toEqual([
      { column: "Section Name", raw: null, stored: "Untitled Section", explanation: null },
    ]);

    const unsplit = withoutIssue(draft, 6, "split-run");
    const splitBroken = reconcile(unsplit, unsplit.tree);
    expect(splitBroken.rows.find((row) => row.sourceRow === 6)?.status).toBe("✗");
    expect(differencesOn(splitBroken.rows, 6, "Split run")).toEqual([
      { column: "Split run", raw: "item", stored: "Untitled Item", explanation: null },
    ]);
  });

  it("groups a blank name with the literal Untitled title and reports no boundary", async () => {
    const draft = expectDraft(
      await parseSpectoraExport(
        await workbook(HEADERS, [
          rowFor(HEADERS, { "section name": null, "item name": "Doors", "comment name": "Latch" }),
          rowFor(HEADERS, { "section name": "Untitled Section", "item name": null, "comment name": "Hinge" }),
          rowFor(HEADERS, { "section name": "Untitled Section", "item name": "Untitled Item", "comment name": "Strike" }),
        ]),
        "untitled-literal.xls",
      ),
    );

    expect(outline(draft)).toEqual([
      {
        name: "Untitled Section",
        items: [
          { name: "Doors", comments: [{ row: 2, name: "Latch", commentType: "info" }] },
          {
            name: "Untitled Item",
            comments: [
              { row: 3, name: "Hinge", commentType: "info" },
              { row: 4, name: "Strike", commentType: "info" },
            ],
          },
        ],
      },
    ]);
    expectRoundTrip(draft);
    const explained = reconcile(draft, draft.tree);
    expect(differencesOn(explained.rows, 3, "Section boundary")).toEqual([]);
    expect(differencesOn(explained.rows, 4, "Item boundary")).toEqual([]);
  });
});

function readFixture(file: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, file));
}

function expectDraft(result: ParseResult, file?: string): ImportDraft {
  if (!result.ok) {
    const where = file === undefined ? "rejected" : `${file} was rejected`;
    throw new Error(`${where}: ${result.rejection.kind}`);
  }
  return result.draft;
}

async function draftOf(file: string): Promise<ImportDraft> {
  return expectDraft(await parseSpectoraExport(readFixture(file), file), file);
}

/**
 * Source-span tokens that stay a warning of their own. The sanitiser's `unsafeValue` flag
 * covers the same tokens when they only appear after decoding.
 */
const UNSAFE_STYLE = /url\(|expression\(|@import/i;

/** Import issue kinds that do not come from a sanitiser cut, so they carry no evidence. */
const KINDS_WITHOUT_CUTS = new Set<IssueKind>([
  "whitespace-trimmed",
  "vocabulary-normalised",
  "boolean-default-normalised",
  "boolean-default-invalid",
  "checkbox-default-not-in-options",
  "empty-option-dropped",
  "options-orphan",
  "comment-type-fallback",
  "answer-type-fallback",
  "category-missing",
  "category-orphan",
  "blank-name",
  "split-run",
  "duplicate-comment",
]);

/** Routine editor leftovers and CSS removals share one notice. Dangerous CSS does not. */
function isBundledCut(cut: Cut): boolean {
  if (cut.kind === "editor-leftover") return true;
  if (cut.kind !== "css-property-removed") return false;
  return cut.context.unsafeValue !== true && !UNSAFE_STYLE.test(cut.removedText);
}

function issueKindFor(cut: Cut): string {
  if (isBundledCut(cut)) return "editor-leftovers";
  if (cut.kind === "css-property-removed") return "unsafe-style-removed";
  if (cut.kind === "youtube-wrapper-emptied") return "youtube-wrapper-empty";
  return cut.kind;
}

function evidenceOf(cut: Cut) {
  return {
    start: cut.start,
    end: cut.end,
    kind: cut.kind,
    removedText: cut.removedText,
    replacement: cut.replacement ?? null,
  };
}

function byStart<T extends { start: number }>(cuts: T[]): T[] {
  return [...cuts].sort((left, right) => left.start - right.start);
}

function catalogueEntry(kind: string) {
  const entry = catalogue.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`No catalogue entry for ${kind}`);
  return entry;
}

async function workbookWithCommentText(texts: readonly string[]): Promise<Uint8Array> {
  const commentText = HEADERS.indexOf("Comment Text");
  const commentType = HEADERS.indexOf("Comment Type (info, limit, defect)");
  const answerType = HEADERS.indexOf("Answer Type (boolean, checkbox, date, number, range, text)");
  const rows = [
    [...HEADERS],
    ...texts.map((text, index) => {
      const row = HEADERS.map(() => "");
      row[0] = "Section";
      row[1] = "Item";
      row[2] = `Comment ${index + 1}`;
      row[commentText] = text;
      row[commentType] = "info";
      row[answerType] = "boolean";
      return row;
    }),
  ];
  return writeXlsxFile(rows).toBuffer();
}

const DEFAULT_CELLS: Record<string, string> = {
  "section name": "Roof",
  "item name": "Covering",
  "comment name": "Shingles",
  "comment text": "<p>Checked</p>",
  "comment type": "info",
  "answer type": "boolean",
};

function withoutHint(header: string): string {
  return header.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function headerKey(header: string): string {
  return withoutHint(header.trim().toLowerCase());
}

function rowFor(
  headers: readonly string[],
  overrides: Record<string, string | number | null> = {},
): (string | number | null)[] {
  return headers.map((header) => {
    if (Object.prototype.hasOwnProperty.call(overrides, header)) return overrides[header] ?? null;
    const key = headerKey(header);
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] ?? null;
    return DEFAULT_CELLS[key] ?? "";
  });
}

async function workbook(headers: readonly string[], rows: (string | number | null)[][]): Promise<Uint8Array> {
  return writeXlsxFile([[...headers], ...rows]).toBuffer();
}

const FILE_SHAPE_KINDS = new Set<IssueKind>(["expected-column-missing", "unknown-column", "extra-sheet"]);

function fileShapeIssues(draft: ImportDraft) {
  return draft.issues.filter((issue) => FILE_SHAPE_KINDS.has(issue.kind));
}

function expectRoundTrip(draft: ImportDraft): void {
  const parsed = importDraftSchema.safeParse(draft);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  const exported = toExportRows(draft.tree, draft);
  expect(exported.map((row) => row.sourceRow)).toEqual(draft.sourceRows.map((row) => row.rowNumber));
  const result = reconcile(draft, draft.tree);
  expect(result.unexplained).toBe(0);
  expect(result.verified).toBe(result.total);
}

const COMMENT_TYPE = "Comment Type (info, limit, defect)";
const ANSWER_TYPE = "Answer Type (boolean, checkbox, date, number, range, text)";
const CATEGORY = "Category (-1: Low, 0: Med, 1: High)";
const DEFAULT_VALUE = "Default Value";
const CHOICE_OPTIONS = "Multiple Choice Options (comma-separated)";
const UNIT_OPTIONS = "Unit Type Options (numeric answers only, comma-separated)";

const VOCABULARY_KINDS = new Set<IssueKind>([
  "vocabulary-normalised",
  "comment-type-fallback",
  "answer-type-fallback",
  "category-missing",
  "category-orphan",
  "whitespace-trimmed",
]);

const FLAGGED = [
  {
    name: "Odd defect",
    kind: "vocabulary-normalised",
    difference: {
      column: COMMENT_TYPE,
      raw: " Defect",
      stored: "defect",
      explanation: { issues: ["vocabulary-normalised"] },
    },
  },
  {
    name: "Unknown type",
    kind: "comment-type-fallback",
    difference: {
      column: COMMENT_TYPE,
      raw: " Nope ",
      stored: "info",
      explanation: { issues: ["comment-type-fallback"] },
    },
  },
  {
    name: "Blank type",
    kind: "comment-type-fallback",
    difference: {
      column: COMMENT_TYPE,
      raw: null,
      stored: "info",
      explanation: { issues: ["comment-type-fallback"] },
    },
  },
  {
    name: "Odd answer",
    kind: "vocabulary-normalised",
    difference: {
      column: ANSWER_TYPE,
      raw: " TEXT",
      stored: "text",
      explanation: { issues: ["vocabulary-normalised"] },
    },
  },
  {
    name: "Unknown answer",
    kind: "answer-type-fallback",
    difference: {
      column: ANSWER_TYPE,
      raw: "maybe",
      stored: "boolean",
      explanation: { issues: ["answer-type-fallback"] },
    },
  },
  {
    name: "Blank answer",
    kind: "answer-type-fallback",
    difference: {
      column: ANSWER_TYPE,
      raw: null,
      stored: "boolean",
      explanation: { issues: ["answer-type-fallback"] },
    },
  },
  {
    name: "No category",
    kind: "category-missing",
    difference: { column: CATEGORY, raw: null, stored: null, explanation: { issues: ["category-missing"] } },
  },
  {
    name: "Invalid category",
    kind: "category-missing",
    difference: { column: CATEGORY, raw: 2, stored: null, explanation: { issues: ["category-missing"] } },
  },
  {
    name: "Info category",
    kind: "category-orphan",
    difference: { column: CATEGORY, raw: 1, stored: 1, explanation: { issues: ["category-orphan"] } },
  },
  {
    name: "Limit category",
    kind: "category-orphan",
    difference: { column: CATEGORY, raw: -1, stored: -1, explanation: { issues: ["category-orphan"] } },
  },
  {
    name: "Decoded odd type",
    kind: "vocabulary-normalised",
    difference: {
      column: COMMENT_TYPE,
      raw: "&#73;nfo",
      stored: "info",
      explanation: { issues: ["vocabulary-normalised"] },
    },
  },
] as const;

const DEFAULT_ISSUE_KINDS = new Set<IssueKind>([
  "boolean-default-normalised",
  "boolean-default-invalid",
  "checkbox-default-not-in-options",
  "empty-option-dropped",
  "options-orphan",
  "whitespace-trimmed",
]);

const DEFAULT_FLAGGED = [
  {
    name: "Lower t",
    kind: "boolean-default-normalised",
    difference: {
      column: DEFAULT_VALUE,
      raw: "t",
      stored: "true",
      explanation: { issues: ["boolean-default-normalised"] },
    },
  },
  {
    name: "Upper F",
    kind: "boolean-default-normalised",
    difference: {
      column: DEFAULT_VALUE,
      raw: "F",
      stored: "false",
      explanation: { issues: ["boolean-default-normalised"] },
    },
  },
  {
    name: "Padded true",
    kind: "boolean-default-normalised",
    difference: {
      column: DEFAULT_VALUE,
      raw: " true",
      stored: "true",
      explanation: { issues: ["boolean-default-normalised"] },
    },
  },
  {
    name: "Maybe",
    kind: "boolean-default-invalid",
    difference: {
      column: DEFAULT_VALUE,
      raw: "maybe",
      stored: null,
      explanation: { issues: ["boolean-default-invalid"] },
    },
  },
  {
    name: "Not an option",
    kind: "checkbox-default-not-in-options",
    difference: {
      column: DEFAULT_VALUE,
      raw: "Other",
      stored: "Other",
      explanation: { issues: ["checkbox-default-not-in-options"] },
    },
  },
  {
    name: "Trimmed missing",
    kind: "whitespace-trimmed",
    difference: {
      column: DEFAULT_VALUE,
      raw: " Other ",
      stored: "Other",
      explanation: { issues: ["whitespace-trimmed", "checkbox-default-not-in-options"] },
    },
  },
  {
    name: "Trimmed missing",
    kind: "checkbox-default-not-in-options",
    difference: {
      column: DEFAULT_VALUE,
      raw: " Other ",
      stored: "Other",
      explanation: { issues: ["whitespace-trimmed", "checkbox-default-not-in-options"] },
    },
  },
  {
    name: "Trimmed present",
    kind: "whitespace-trimmed",
    difference: {
      column: DEFAULT_VALUE,
      raw: " Client ",
      stored: "Client",
      explanation: { issues: ["whitespace-trimmed"] },
    },
  },
  {
    name: "Empty entry",
    kind: "empty-option-dropped",
    difference: {
      column: CHOICE_OPTIONS,
      raw: "wood,,metal",
      stored: "wood, metal",
      explanation: { issues: ["empty-option-dropped"] },
    },
  },
  {
    name: "Spaced options",
    kind: null,
    difference: {
      column: CHOICE_OPTIONS,
      raw: "wood,metal",
      stored: "wood, metal",
      explanation: { rule: "option-list" },
    },
  },
  {
    name: "Text options",
    kind: "options-orphan",
    difference: {
      column: CHOICE_OPTIONS,
      raw: "Yes, No",
      stored: "Yes, No",
      explanation: { issues: ["options-orphan"] },
    },
  },
  {
    name: "Unit empty",
    kind: "empty-option-dropped",
    difference: {
      column: UNIT_OPTIONS,
      raw: "F,,C",
      stored: "F, C",
      explanation: { issues: ["empty-option-dropped"] },
    },
  },
  {
    name: "Decoded default",
    kind: null,
    difference: {
      column: DEFAULT_VALUE,
      raw: "&amp;lt;",
      stored: "&lt;",
      explanation: { rule: "entity-decoding" },
    },
  },
  {
    name: "Decoded option",
    kind: null,
    difference: {
      column: CHOICE_OPTIONS,
      raw: "&amp;lt;",
      stored: "&lt;",
      explanation: { rule: "entity-decoding" },
    },
  },
  {
    name: "Text trim",
    kind: "whitespace-trimmed",
    difference: {
      column: DEFAULT_VALUE,
      raw: "  hello  ",
      stored: "hello",
      explanation: { issues: ["whitespace-trimmed"] },
    },
  },
] as const;

async function defaultsDraft(): Promise<ImportDraft> {
  const rows = [
    rowFor(HEADERS, { "comment name": "Lower t", "default value": "t" }),
    rowFor(HEADERS, { "comment name": "Upper F", "default value": "F" }),
    rowFor(HEADERS, { "comment name": "Padded true", "default value": " true" }),
    rowFor(HEADERS, { "comment name": "Maybe", "default value": "maybe" }),
    rowFor(HEADERS, { "comment name": "Exact true", "default value": "true" }),
    xlsxBooleanDefault("Xlsx false", false),
    rowFor(HEADERS, { "comment name": "Not an option", "answer type": "checkbox", "default value": "Other", "multiple choice options": "Client, Agent" }),
    rowFor(HEADERS, { "comment name": "Trimmed missing", "answer type": "checkbox", "default value": " Other ", "multiple choice options": "Client, Agent" }),
    rowFor(HEADERS, { "comment name": "Trimmed present", "answer type": "checkbox", "default value": " Client ", "multiple choice options": "Client, Agent" }),
    rowFor(HEADERS, { "comment name": "Empty entry", "answer type": "checkbox", "multiple choice options": "wood,,metal" }),
    rowFor(HEADERS, { "comment name": "Spaced options", "answer type": "checkbox", "multiple choice options": "wood,metal" }),
    rowFor(HEADERS, { "comment name": "Duplicate options", "answer type": "checkbox", "multiple choice options": "a, a" }),
    rowFor(HEADERS, { "comment name": "Text options", "answer type": "text", "multiple choice options": "Yes, No" }),
    rowFor(HEADERS, { "comment name": "Unit empty", "answer type": "number", "unit type options": "F,,C" }),
    rowFor(HEADERS, { "comment name": "Decoded default", "answer type": "text", "default value": "&amp;lt;" }),
    rowFor(HEADERS, { "comment name": "Decoded option", "answer type": "checkbox", "multiple choice options": "&amp;lt;" }),
    rowFor(HEADERS, { "comment name": "Text trim", "answer type": "text", "default value": "  hello  " }),
    rowFor(HEADERS, { "comment name": "Blank boolean", "default value": "   " }),
  ];
  return expectDraft(await parseSpectoraExport(await writeXlsxFile([HEADERS, ...rows]).toBuffer(), "defaults.xls"));
}

/** `rowFor` cannot write an xlsx boolean cell, so the Default Value cell is replaced after the row is built. */
function xlsxBooleanDefault(name: string, value: boolean) {
  const row = rowFor(HEADERS, { "comment name": name, "answer type": "boolean", "default value": null });
  const defaultIndex = HEADERS.indexOf(DEFAULT_VALUE);
  return row.map((cell, index) => (index === defaultIndex ? { value, type: Boolean } : cell));
}

function storedDefaults(draft: ImportDraft) {
  return commentsIn(draft.tree).map((comment) => ({
    name: comment.name,
    answerType: comment.answerType,
    defaultBoolean: comment.defaultBoolean,
    defaultText: comment.defaultText,
    choiceOptions: comment.choiceOptions,
    unitOptions: comment.unitOptions,
  }));
}

function defaultIssues(draft: ImportDraft, name: string) {
  const rowNumber = sourceRow(draft, name);
  return draft.issues.filter((issue) => issue.sourceRow === rowNumber && DEFAULT_ISSUE_KINDS.has(issue.kind));
}

async function vocabularyDraft(): Promise<ImportDraft> {
  return expectDraft(
    await parseSpectoraExport(
      await workbook(HEADERS, [
        rowFor(HEADERS, { "comment name": "Odd defect", "comment type": " Defect", category: 0 }),
        rowFor(HEADERS, { "comment name": "Unknown type", "comment type": " Nope " }),
        rowFor(HEADERS, { "comment name": "Blank type", "comment type": null }),
        rowFor(HEADERS, { "comment name": "Odd answer", "answer type": " TEXT" }),
        rowFor(HEADERS, { "comment name": "Unknown answer", "answer type": "maybe" }),
        rowFor(HEADERS, { "comment name": "Blank answer", "answer type": null }),
        rowFor(HEADERS, { "comment name": "No category", "comment type": "defect", category: null }),
        rowFor(HEADERS, { "comment name": "Invalid category", "comment type": "defect", category: 2 }),
        rowFor(HEADERS, { "comment name": "Info category", "comment type": "info", category: 1 }),
        rowFor(HEADERS, { "comment name": "Limit category", "comment type": "limit", category: -1 }),
        rowFor(HEADERS, { "comment name": "String zero", "comment type": "defect", category: "0" }),
        rowFor(HEADERS, { "comment name": "Decimal zero", "comment type": "defect", category: "0.0" }),
        rowFor(HEADERS, { "comment name": "Padded category", "comment type": "defect", category: " 1 " }),
        rowFor(HEADERS, { "comment name": "Dropped category", "comment type": "info", category: "high" }),
        rowFor(HEADERS, { "comment name": "Decoded type", "comment type": "&#105;nfo" }),
        rowFor(HEADERS, { "comment name": "Decoded odd type", "comment type": "&#73;nfo" }),
      ]),
      "vocabulary.xls",
    ),
  );
}

function storedFields(draft: ImportDraft) {
  return commentsIn(draft.tree).map((comment) => ({
    name: comment.name,
    commentType: comment.commentType,
    answerType: comment.answerType,
    category: comment.category,
  }));
}

function sourceRow(draft: ImportDraft, name: string): number {
  const row = commentsIn(draft.tree).find((comment) => comment.name === name)?.sourceRow;
  if (row === undefined || row === null) throw new Error(`No Source row for ${name}`);
  return row;
}

function sourceCell(draft: ImportDraft, name: string, header: string): Cell {
  const rowNumber = sourceRow(draft, name);
  const index = draft.run.headers.indexOf(header);
  return draft.sourceRows.find((row) => row.rowNumber === rowNumber)?.cells[index] ?? null;
}

function vocabularyIssues(draft: ImportDraft, name: string) {
  const rowNumber = sourceRow(draft, name);
  return draft.issues.filter((issue) => issue.sourceRow === rowNumber && VOCABULARY_KINDS.has(issue.kind));
}

function issue(draft: ImportDraft, name: string, kind: IssueKind, detail: unknown) {
  return { kind, sourceRow: sourceRow(draft, name), detail, cuts: [] };
}

function outline(draft: ImportDraft) {
  return draft.tree.sections.map((section) => ({
    name: section.name,
    items: section.items.map((item) => ({
      name: item.name,
      comments: item.comments.map((comment) => ({
        row: comment.sourceRow,
        name: comment.name,
        commentType: comment.commentType,
      })),
    })),
  }));
}

function withoutIssue(draft: ImportDraft, sourceRowNumber: number, kind: IssueKind): ImportDraft {
  const copy = structuredClone(draft);
  const index = copy.issues.findIndex((entry) => entry.sourceRow === sourceRowNumber && entry.kind === kind);
  if (index < 0) throw new Error(`No ${kind} issue on row ${sourceRowNumber}`);
  copy.issues.splice(index, 1);
  return copy;
}

function detailField(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || !("field" in detail)) return null;
  return typeof detail.field === "string" ? detail.field : null;
}

function differencesOn(rows: readonly ReconcileRow[], sourceRowNumber: number, column: string): ReconcileRow["differences"] {
  const row = rows.find((candidate) => candidate.sourceRow === sourceRowNumber);
  if (!row) return [];
  return row.differences.filter((difference) => difference.column === column);
}

function categoryDifferences(rows: readonly ReconcileRow[], sourceRowNumber: number): ReconcileRow["differences"] {
  return differencesOn(rows, sourceRowNumber, CATEGORY);
}

function commentFields(comment: Comment) {
  return {
    name: comment.name,
    commentType: comment.commentType,
    answerType: comment.answerType,
    category: comment.category,
    recommendation: comment.recommendation,
    choiceOptions: comment.choiceOptions,
    unitOptions: comment.unitOptions,
    defaultBoolean: comment.defaultBoolean,
    defaultText: comment.defaultText,
    textHtml: comment.textHtml,
  };
}
