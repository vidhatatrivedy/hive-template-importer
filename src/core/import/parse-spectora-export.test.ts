import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderIssueMessage } from "@/core/import/catalogue";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { sanitiseCommentHtml } from "@/core/sanitise";
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
      const bytes = readFixture(fixture.file);
      const result = await parseSpectoraExport(bytes, fixture.file);
      expect(result.ok, fixture.file).toBe(true);

      const { draft } = result;
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
      const bytes = readFixture(fixture.file);
      const result = await parseSpectoraExport(bytes, fixture.file);
      expect(result.ok).toBe(true);

      expect(result.draft.suggestedName, fixture.file).toBe(fixture.suggestedName);
      expect(result.draft.run, fixture.file).toMatchObject({
        filename: fixture.file,
        sha256: fixture.sha256,
        byteSize: fixture.byteSize,
        sheetName: "Sheet1",
        rowsRead: fixture.rows,
        blankRows: 0,
        valuesDecoded: fixture.valuesDecoded,
      });
      expect(result.draft.run.headers, fixture.file).toEqual(HEADERS);
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

  it("falls back when the filename is only an extension or only an export date", async () => {
    const bytes = readFixture("Radon Inspection-2026-09-30.xls");
    const untitled = await parseSpectoraExport(bytes, ".xls");
    const dateOnly = await parseSpectoraExport(bytes, "-2026-09-30.xls");
    expect(untitled.ok).toBe(true);
    expect(untitled.draft.suggestedName).toBe("Untitled Template");
    expect(dateOnly.ok).toBe(true);
    expect(dateOnly.draft.suggestedName).toBe("-2026-09-30");
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
});

function readFixture(file: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, file));
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(readFixture(file), file);
  return result.draft;
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
