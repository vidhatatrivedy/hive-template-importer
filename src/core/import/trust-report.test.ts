import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogueEntry, issueKinds } from "@/core/import/catalogue";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { Cell } from "@/core/import/reconcile";
import type { Comment, EditableTree, ImportDraft, ImportEvidence, ImportIssue, Section } from "@/core/import/schemas";
import { buildTrustReport } from "@/core/import/trust-report";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

const RESIDENTIAL = "InterNACHI Residential -2026-09-30.xls";
const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";
const RADON = "Radon Inspection-2026-09-30.xls";

const MISSING_FROM_EXPORT = [
  "empty Sections and Items",
  "Section and Item settings",
  "template attachments",
  "the template name",
  "recommendation labels",
  "default photos as files",
];

describe("buildTrustReport", () => {
  it("reports InterNACHI Residential as 392 / 392, with Section rows that sum to the totals", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const report = buildTrustReport(draft, draft.tree);

    expect(report.summary).toEqual({
      filename: RESIDENTIAL,
      sha256: "4aeb50ad",
      byteSize: 55565,
      rowsRead: 392,
      blankRows: 0,
      commentsStored: 392,
      sections: 13,
      items: 69,
      comments: 392,
      bySeverity: { warning: 1, notice: 13 },
      byClass: { Changed: 11, Unsupported: 1, "Missing from export": 1, Check: 1 },
      valuesDecoded: 252,
      verdict: { verified: 392, total: 392 },
    });
    expect(report.sections).toHaveLength(13);
    expect(report.sections.reduce((total, section) => total + section.itemCount, 0)).toBe(69);
    expect(report.sections.reduce((total, section) => total + section.comments, 0)).toBe(392);
    expect(report.sections.reduce((total, section) => total + section.sourceRows, 0)).toBe(392);
    expect(report.sections.reduce((total, section) => total + section.issues, 0)).toBe(13);
    expect(
      report.sections.reduce((total, section) => total + section.items.reduce((sum, item) => sum + item.issues, 0), 0),
    ).toBe(13);
    expect(report.sections.every((section) => section.status === "✓" && !section.split)).toBe(true);
    expect(report.sections.every((section) => section.items.every((item) => item.status === "✓" && !item.split))).toBe(true);
    expect(report.sections[0]).toMatchObject({
      name: "Inspection Details",
      split: false,
      sourceRows: 6,
      comments: 6,
      itemCount: 1,
      status: "✓",
    });
    expect(report.sections[0]?.items).toEqual([
      expect.objectContaining({
        name: "General",
        split: false,
        sourceRows: 6,
        comments: 6,
        status: "✓",
      }),
    ]);
    expect(report.rows).toHaveLength(392);
    expect(report.rows.every((row) => row.status === "✓")).toBe(true);
    expect(report.rows.map((row) => row.sourceRow)).toEqual(draft.sourceRows.map((row) => row.rowNumber));

    const itemColumn = draft.run.headers.indexOf("Item Name");
    const encoded = draft.sourceRows.find((row) => row.cells[itemColumn] === "Siding, Flashing &amp; Trim");
    expect(report.rows.find((row) => row.sourceRow === encoded?.rowNumber)?.differences).toContainEqual({
      column: "Item Name",
      raw: "Siding, Flashing &amp; Trim",
      stored: "Siding, Flashing & Trim",
      explanation: { rule: "entity-decoding" },
    });
    expect(report.missingFromExport).toEqual({
      entries: MISSING_FROM_EXPORT,
      expectedColumnMissing: 0,
      youtubeWrapperEmpty: 1,
    });
    expect(report.keptButNotUsed.map((column) => column.column)).toEqual([
      "Default Value 2",
      "Default Unit Type",
      "Default Location",
      "Locked",
      "Simple Format",
      "Disable Photos",
      "Uses",
      "Default photos",
    ]);
    expect(report.keptButNotUsed.find((column) => column.column === "Uses")?.nonDefaultRows).toBe(0);
    expect(report.keptButNotUsed.find((column) => column.column === "Default photos")?.nonDefaultRows).toBe(0);
  });

  it("groups Import issues in catalogue order and locates every row issue", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const report = buildTrustReport(draft, draft.tree);
    const kinds = report.issueGroups.map((group) => group.kind);

    expect(kinds).toEqual(issueKinds.filter((kind) => kinds.includes(kind)));
    expect(report.issueGroups.reduce((total, group) => total + group.count, 0)).toBe(draft.issues.length);
    for (const group of report.issueGroups) {
      const entry = catalogueEntry(group.kind);
      expect(group.severity).toBe(entry.severity);
      expect(group.class).toBe(entry.class);
      expect(group.title).toBe(entry.title);
      expect(group.count).toBe(group.issues.length);
      for (const issue of group.issues) {
        if (issue.sourceRow === null) {
          expect(issue.location).toBeNull();
          continue;
        }
        expect(issue.location).not.toBeNull();
        if (!issue.location) continue;
        expect(issue.location.section.length).toBeGreaterThan(0);
        expect(issue.location.item.length).toBeGreaterThan(0);
        expect(issue.location.comment.length).toBeGreaterThan(0);
      }
    }

    const benDraft = await draftOf(BEN);
    const ben = buildTrustReport(benDraft, benDraft.tree);
    const duplicate = ben.issueGroups
      .find((group) => group.kind === "duplicate-comment")
      ?.issues.find((issue) => issue.sourceRow === 308);
    expect(duplicate).toEqual({
      sourceRow: 308,
      location: {
        section: "Basement, Foundation, Crawlspace & Structure",
        item: "Basement",
        comment: "Missing GFCI in Unfinished Basement",
      },
      message: '"Missing GFCI in Unfinished Basement" (Deficiency) is repeated on rows 306 and 308. Each one was kept.',
      cuts: [],
    });
  });

  it("groups Ben's External assets under cdn.spectora.com and www.youtube.com", async () => {
    const draft = await draftOf(BEN);
    const report = buildTrustReport(draft, draft.tree);
    const urls = report.externalAssets.flatMap((host) => host.urls.map((asset) => asset.url));

    expect(report.externalAssets.map((host) => host.host).sort()).toEqual(["cdn.spectora.com", "www.youtube.com"]);
    expect(urls.some((url) => url.includes("default_photos"))).toBe(false);
    expect(report.keptButNotUsed.find((column) => column.column === "Default photos")?.nonDefaultRows).toBe(18);
  });

  it("gives Radon 2 Sections, 3 Items and the Missing-from-export block", async () => {
    const draft = await draftOf(RADON);
    const report = buildTrustReport(draft, draft.tree);

    expect(report.summary.sections).toBe(2);
    expect(report.summary.items).toBe(3);
    expect(report.sections.map((section) => section.name)).toEqual(["Details", "Radon"]);
    expect(report.sections.map((section) => section.itemCount)).toEqual([2, 1]);
    expect(report.sections.flatMap((section) => section.items.map((item) => item.name))).toEqual([
      "General",
      "Monitor Type",
      "Summary",
    ]);
    expect(report.missingFromExport).toEqual({
      entries: MISSING_FROM_EXPORT,
      expectedColumnMissing: 0,
      youtubeWrapperEmpty: 0,
    });
  });

  it("drops the verdict and marks the affected Section when stored text changes", async () => {
    const draft = structuredClone(await draftOf(RESIDENTIAL));
    const cracking = commentOn(draft, 10);
    expect(cracking.name).toBe("Cracking - Major");
    cracking.textHtml = `${cracking.textHtml}x`;

    const report = buildTrustReport(draft, draft.tree);

    expect(report.summary.verdict).toEqual({ verified: 391, total: 392 });
    expect(report.rows.find((row) => row.sourceRow === 10)?.status).toBe("✗");
    expect(report.sections.filter((section) => section.status === "✗").map((section) => section.name)).toEqual([
      "Exterior",
    ]);
    expect(
      report.sections
        .find((section) => section.name === "Exterior")
        ?.items.filter((item) => item.status === "✗")
        .map((item) => item.name),
    ).toEqual(["Siding, Flashing & Trim"]);
    expect(report.sections.find((section) => section.name === "Inspection Details")?.status).toBe("✓");
  });

  it("counts non-default raw-only rows and ignores anchors and relative images", () => {
    const { evidence, tree } = synthetic({
      headers: ["Uses", "Default Location", "Default Photo 1", "Default Photo 1 Caption"],
      rows: [
        [0, null, null, null],
        ["0", " Kitchen", "https://cdn.spectora.com/default_photos/a.jpg", null],
        [1, "  ", null, "cap"],
      ],
      sections: [
        {
          name: "Roof",
          items: [
            {
              name: "Flashing",
              comments: [
                comment(
                  2,
                  "One",
                  '<a href="https://example.com/page">link</a>' +
                    '<img src="https://cdn.spectora.com/editor_assets/images/a.png">' +
                    '<iframe src="https://www.youtube.com/embed/abc"></iframe>' +
                    '<img src="/local.png">',
                ),
                comment(3, "Two", '<img src="https://cdn.spectora.com/editor_assets/images/a.png">'),
                comment(4, "Three", ""),
              ],
            },
          ],
        },
      ],
    });

    const report = buildTrustReport(evidence, tree);

    expect(report.keptButNotUsed).toEqual([
      { column: "Default Location", nonDefaultRows: 1 },
      { column: "Uses", nonDefaultRows: 1 },
      { column: "Default photos", nonDefaultRows: 2 },
    ]);
    expect(report.externalAssets).toEqual([
      {
        host: "cdn.spectora.com",
        urls: [{ url: "https://cdn.spectora.com/editor_assets/images/a.png", sourceRows: [2, 3] }],
      },
      {
        host: "www.youtube.com",
        urls: [{ url: "https://www.youtube.com/embed/abc", sourceRows: [2] }],
      },
    ]);
  });

  it("marks the later run of a split Section or Item", () => {
    const split = (level: "section" | "item", name: string, sourceRow: number): ImportIssue => ({
      kind: "split-run",
      sourceRow,
      detail: { level, name, firstRow: sourceRow, lastRow: sourceRow, earlierRuns: [{ firstRow: 2, lastRow: 2 }] },
      cuts: [],
    });
    const { evidence, tree } = synthetic({
      headers: ["Section Name"],
      rows: [["Roof"], ["Roof"], ["Roof"], ["Plumbing"], ["Roof"]],
      issues: [split("item", "Flashing", 4), split("section", "Roof", 6)],
      sections: [
        {
          name: "Roof",
          items: [
            { name: "Flashing", comments: [comment(2, "One")] },
            { name: "Gutters", comments: [comment(3, "Two")] },
            { name: "Flashing", comments: [comment(4, "Three")] },
          ],
        },
        { name: "Plumbing", items: [{ name: "Pipes", comments: [comment(5, "Four")] }] },
        { name: "Roof", items: [{ name: "Decking", comments: [comment(6, "Five")] }] },
      ],
    });

    const report = buildTrustReport(evidence, tree);

    expect(report.sections.map((section) => ({ name: section.name, split: section.split }))).toEqual([
      { name: "Roof", split: false },
      { name: "Plumbing", split: false },
      { name: "Roof", split: true },
    ]);
    expect(report.sections[0]?.items.map((item) => ({ name: item.name, split: item.split }))).toEqual([
      { name: "Flashing", split: false },
      { name: "Gutters", split: false },
      { name: "Flashing", split: true },
    ]);
    expect(report.sections[1]?.items.every((item) => !item.split)).toBe(true);
    expect(report.sections[2]?.items.every((item) => !item.split)).toBe(true);
  });
});

function comment(sourceRow: number, name: string, textHtml = ""): Comment {
  return {
    sourceRow,
    name,
    textHtml,
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

function synthetic(input: {
  headers: string[];
  rows: Cell[][];
  sections: Section[];
  issues?: ImportIssue[];
}): { evidence: ImportEvidence; tree: EditableTree } {
  return {
    evidence: {
      run: {
        filename: "synthetic.xls",
        sha256: "ab".repeat(32),
        byteSize: 12,
        sheetName: "Sheet1",
        headers: input.headers,
        rowsRead: input.rows.length,
        blankRows: 0,
        valuesDecoded: 0,
      },
      sourceRows: input.rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
      issues: input.issues ?? [],
    },
    tree: { sections: input.sections },
  };
}

function commentOn(draft: ImportDraft, sourceRow: number): Comment {
  for (const section of draft.tree.sections) {
    for (const item of section.items) {
      const found = item.comments.find((entry) => entry.sourceRow === sourceRow);
      if (found) return found;
    }
  }
  throw new Error(`No Comment for Source row ${sourceRow}`);
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
