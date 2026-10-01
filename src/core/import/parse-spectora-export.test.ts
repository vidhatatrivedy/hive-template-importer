import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { catalogue, renderIssueMessage, type IssueKind } from "@/core/import/catalogue";
import { MAX_UPLOAD_BYTES, rejectionMessage } from "@/core/import/rejections";
import { parseSpectoraExport, type ParseResult } from "@/core/import/parse-spectora-export";
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
      "This file is 5242880 bytes, which is over the 4194304-byte limit.",
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
const KINDS_WITHOUT_CUTS = new Set<IssueKind>(["whitespace-trimmed"]);

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
