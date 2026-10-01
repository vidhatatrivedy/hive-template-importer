import { describe, expect, it } from "vitest";
import type { ImportIssue } from "@/core/import/schemas";
import { buildTrustReport } from "@/core/import/trust-report";
import type { Cell } from "@/core/import/reconcile";
import { ADDED_IN_THE_EDITOR, sourceRowView } from "@/app/source-row-view";

describe("sourceRowView", () => {
  it("says a row that isn't in the evidence is not a Source row, and nothing else", () => {
    const { report, evidence, tree } = sample();

    expect(sourceRowView(report, evidence, tree, 1)).toEqual({
      kind: "missing",
      message: "Row 1 isn't a Source row of this import.",
    });
    expect(sourceRowView(report, evidence, tree, 99999)).toEqual({
      kind: "missing",
      message: "Row 99999 isn't a Source row of this import.",
    });
  });

  it("says the row was stored exactly, and the text was not changed", () => {
    const view = viewFor(2);

    expect(view).toMatchObject({
      kind: "row",
      title: "Source row 2",
      location: "Roof › Flashing › Cracks",
      fields: [],
      exact: "Stored exactly as in the file.",
      textNote: "No changes to the text.",
      storedHtml: "Fine",
    });
    if (view.kind !== "row") return;
    expect(view.segments).toEqual([{ kind: "kept", text: "Fine" }]);
    expect(view.issues).toEqual([]);
    expect(view.cells).toEqual([
      { header: "Section Name", value: "Roof" },
      { header: "Item Name", value: "Flashing" },
      { header: "Comment Name", value: "Cracks" },
      { header: "Comment Text", value: "Fine" },
    ]);
  });

  it("makes leading and trailing whitespace visible and names the issue", () => {
    const view = viewFor(3);
    expect(view).toMatchObject({
      kind: "row",
      exact: null,
      fields: [
        {
          column: "Comment Name",
          raw: "··Cracks·",
          stored: "Cracks",
          explanation: "Whitespace trimmed",
        },
      ],
    });
  });

  it("names a rule, such as entity decoding, when that is what changed the field", () => {
    const view = viewFor(4);
    expect(view).toMatchObject({
      fields: [
        {
          column: "Comment Name",
          raw: "A &amp; B",
          stored: "A & B",
          explanation: "entity decoding",
        },
      ],
    });
  });

  it("lists the row's Import issues and the Comment Text with its cuts", () => {
    const view = viewFor(5);

    expect(view).toMatchObject({
      kind: "row",
      location: "Roof › Flashing › Cut",
      textNote: null,
      storedHtml: "Hi",
      issues: [
        {
          severity: "warning",
          class: "Changed",
          message: "A <script> tag was removed along with its content.",
        },
      ],
    });
    if (view.kind !== "row") return;
    expect(view.segments).toEqual([
      { kind: "removed", text: "<script>x</script>", cutKind: "tag-removed" },
      { kind: "kept", text: "Hi" },
    ]);
    expect(view.fields).toContainEqual({
      column: "Comment Text",
      raw: "<script>x</script>Hi",
      stored: "Hi",
      explanation: "Tag removed",
    });
  });

  it("calls a difference with no issue or rule Unexplained", () => {
    const view = viewFor(6);
    expect(view).toMatchObject({
      fields: [
        {
          column: "Comment Name",
          raw: "Old",
          stored: "New",
          explanation: "Unexplained",
        },
      ],
    });
  });
});

describe("Added in the editor", () => {
  it("uses the wording slice 5 shows for a Comment with no Source row", () => {
    expect(ADDED_IN_THE_EDITOR).toBe("Added in the editor, no Source row");
  });
});

function viewFor(row: number) {
  const { report, evidence, tree } = sample();
  return sourceRowView(report, evidence, tree, row);
}

function sample() {
  const headers = ["Section Name", "Item Name", "Comment Name", "Comment Text"];
  const script = "<script>x</script>Hi";
  const rows: Cell[][] = [
    ["Roof", "Flashing", "Cracks", "Fine"],
    ["Roof", "Flashing", " \u00A0Cracks ", "Fine"],
    ["Roof", "Flashing", "A &amp; B", "Fine"],
    ["Roof", "Flashing", "Cut", script],
    ["Roof", "Flashing", "Old", "Fine"],
  ];
  const issues: ImportIssue[] = [
    { kind: "whitespace-trimmed", sourceRow: 3, detail: { field: "Comment Name" }, cuts: [] },
    {
      kind: "tag-removed",
      sourceRow: 5,
      detail: { tag: "script" },
      cuts: [
        {
          start: 0,
          end: script.indexOf("Hi"),
          kind: "tag-removed",
          removedText: script.slice(0, script.indexOf("Hi")),
          replacement: null,
        },
      ],
    },
  ];
  const evidence = {
    run: {
      filename: "synthetic.xls",
      sha256: "ab".repeat(32),
      byteSize: 12,
      sheetName: "Sheet1",
      headers,
      rowsRead: rows.length,
      blankRows: 0,
      valuesDecoded: 0,
    },
    sourceRows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
    issues,
  };
  const tree = {
    sections: [
      {
        name: "Roof",
        items: [
          {
            name: "Flashing",
            comments: [
              comment(2, "Cracks", "Fine"),
              comment(3, "Cracks", "Fine"),
              comment(4, "A & B", "Fine"),
              comment(5, "Cut", "Hi"),
              comment(6, "New", "Fine"),
            ],
          },
        ],
      },
    ],
  };
  return { report: buildTrustReport(evidence, tree), evidence, tree };
}

function comment(sourceRow: number, name: string, textHtml: string) {
  return {
    sourceRow,
    name,
    textHtml,
    commentType: "info" as const,
    category: null,
    recommendation: null,
    answerType: "boolean" as const,
    defaultBoolean: null,
    defaultText: null,
    choiceOptions: [],
    unitOptions: [],
  };
}
