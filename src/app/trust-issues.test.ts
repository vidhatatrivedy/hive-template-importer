import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { issueClasses, issueKinds, issueSeverities } from "@/core/import/catalogue";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { ImportDraft } from "@/core/import/schemas";
import { buildTrustReport, type TrustIssueGroup } from "@/core/import/trust-report";
import {
  attachSourceRowLinks,
  filterIssueGroups,
  importIssuesView,
  type ImportIssueGroupView,
} from "@/app/trust-issues";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/spectora");
const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";

describe("importIssuesView", () => {
  it("shows the samples workbook's split-run, blank-name and unsafe-style-removed warnings", async () => {
    const view = importIssuesView(await samplesReportGroups());

    expect(groupOf(view, "split-run")).toMatchObject({
      severity: "warning",
      class: "Check",
      title: "Split run",
      count: 1,
      open: true,
    });
    expect(groupOf(view, "split-run").issues).toEqual([
      {
        location: "Roof › Covering › Underlayment",
        sourceRow: 4,
        message: '"Covering" appears again as its own Item (row 4). An earlier run is row 2.',
      },
    ]);
    expect(groupOf(view, "blank-name")).toMatchObject({
      severity: "warning",
      class: "Changed",
      title: "Blank name",
      count: 1,
      open: true,
    });
    expect(groupOf(view, "blank-name").issues).toEqual([
      {
        location: "Untitled Section › Gutters › Missing section",
        sourceRow: 5,
        message: "Section Name was blank, so it was stored as Untitled Section.",
      },
    ]);
    expect(groupOf(view, "unsafe-style-removed")).toMatchObject({
      severity: "warning",
      class: "Changed",
      title: "Unsafe style removed",
      count: 1,
      open: true,
    });
    expect(groupOf(view, "unsafe-style-removed").issues).toEqual([
      {
        location: "Roof › Covering › Underlayment",
        sourceRow: 4,
        message: "A background style on <p> was removed because its value could load remote content or run code.",
      },
    ]);
  });

  it("gives a file-level issue its message only", async () => {
    const view = importIssuesView(await samplesReportGroups());
    const missing = groupOf(view, "expected-column-missing");

    expect(missing.severity).toBe("warning");
    expect(missing.open).toBe(true);
    expect(missing.issues.every((issue) => issue.location === null && issue.sourceRow === null)).toBe(true);
    expect(missing.issues.map((issue) => issue.message)).toContain(
      "Category wasn't in this export, so it was left empty.",
    );
  });

  it("keeps catalogue order, opens warnings, and closes notices", async () => {
    const draft = await draftOf(BEN);
    const report = buildTrustReport(draft, draft.tree);
    const view = importIssuesView(report.issueGroups);
    const kinds = view.map((group) => group.kind);

    expect(kinds).toEqual(issueKinds.filter((kind) => kinds.includes(kind)));
    expect(view.filter((group) => group.severity === "warning")).toEqual([
      expect.objectContaining({ kind: "attribute-removed", count: 2, open: true }),
    ]);
    const notices = view.filter((group) => group.severity === "notice");
    expect(notices.map((group) => group.kind)).toEqual([
      "raw-only-content",
      "stock-estimates",
      "whitespace-trimmed",
      "boolean-default-normalised",
      "duplicate-comment",
      "editor-leftovers",
    ]);
    expect(notices.every((group) => group.open === false)).toBe(true);
    expect(groupOf(view, "editor-leftovers").count).toBe(38);

    const duplicate = groupOf(view, "duplicate-comment").issues.find((issue) => issue.sourceRow === 308);
    expect(duplicate).toEqual({
      location: "Basement, Foundation, Crawlspace & Structure › Basement › Missing GFCI in Unfinished Basement",
      sourceRow: 308,
      message:
        '"Missing GFCI in Unfinished Basement" (Deficiency) is repeated on rows 306 and 308. Each one was kept.',
    });
    expect(groupOf(view, "duplicate-comment").open).toBe(false);
  });

  it("serializes Ben's issue list without cuts or row checks", async () => {
    const draft = await draftOf(BEN);
    const report = buildTrustReport(draft, draft.tree);

    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.rows.some((row) => row.differences.length > 0)).toBe(true);
    expect(report.issueGroups.some((group) => group.issues.some((issue) => issue.cuts.length > 0))).toBe(true);

    const props = importIssuesView(report.issueGroups);
    expect(hasKey(props, "cuts")).toBe(false);
    expect(hasKey(props, "differences")).toBe(false);
    expect(hasKey(props, "rows")).toBe(false);
    expect(JSON.stringify(props).length).toBeLessThan(JSON.stringify(report.issueGroups).length);
  });
});

describe("filterIssueGroups", () => {
  it("ANDs severity with class, ORs within one axis, and hides a group left empty", () => {
    const groups = sampleGroups();
    const all = { severities: issueSeverities, classes: issueClasses };

    expect(filterIssueGroups(groups, all).map((group) => group.kind)).toEqual([
      "expected-column-missing",
      "blank-name",
      "split-run",
      "editor-leftovers",
    ]);
    expect(filterIssueGroups(groups, { severities: ["warning"], classes: issueClasses }).map((group) => group.kind)).toEqual([
      "expected-column-missing",
      "blank-name",
      "split-run",
    ]);
    expect(filterIssueGroups(groups, { severities: issueSeverities, classes: ["Changed"] }).map((group) => group.kind)).toEqual([
      "blank-name",
      "editor-leftovers",
    ]);
    expect(filterIssueGroups(groups, { severities: ["warning"], classes: ["Check"] }).map((group) => group.kind)).toEqual([
      "split-run",
    ]);
    expect(filterIssueGroups(groups, { severities: ["notice"], classes: ["Changed"] }).map((group) => group.kind)).toEqual([
      "editor-leftovers",
    ]);
    expect(filterIssueGroups(groups, { severities: ["notice"], classes: ["Check"] })).toEqual([]);
    expect(filterIssueGroups(groups, { severities: [], classes: issueClasses })).toEqual([]);

    const counts = groups.map((group) => group.count);
    const changedWarnings = filterIssueGroups(groups, { severities: ["warning"], classes: ["Changed"] });
    expect(changedWarnings.map((group) => group.kind)).toEqual(["blank-name"]);
    expect(changedWarnings[0]?.count).toBe(1);
    expect(groups.map((group) => group.count)).toEqual(counts);
  });
});

describe("attachSourceRowLinks", () => {
  it("links a Source row and leaves a file-level issue without one", () => {
    const linked = attachSourceRowLinks(sampleGroups(), (row) => `/t/abc?pane=trust,versions&row=${row}`);

    expect(groupOf(linked, "split-run").issues[0]?.href).toBe("/t/abc?pane=trust,versions&row=4");
    expect(groupOf(linked, "blank-name").issues[0]?.href).toBe("/t/abc?pane=trust,versions&row=5");
    expect(groupOf(linked, "expected-column-missing").issues[0]?.href).toBeNull();
  });
});

function groupOf<Group extends { kind: string }>(groups: readonly Group[], kind: string): Group {
  const found = groups.find((group) => group.kind === kind);
  if (!found) throw new Error(`No ${kind} group`);
  return found;
}

function sampleGroups(): ImportIssueGroupView[] {
  return [
    {
      kind: "expected-column-missing",
      severity: "warning",
      class: "Missing from export",
      title: "Expected column missing",
      count: 1,
      open: true,
      issues: [{ location: null, sourceRow: null, message: "Category wasn't in this export, so it was left empty." }],
    },
    {
      kind: "blank-name",
      severity: "warning",
      class: "Changed",
      title: "Blank name",
      count: 1,
      open: true,
      issues: [
        {
          location: "Untitled Section › Gutters › Missing section",
          sourceRow: 5,
          message: "Section Name was blank, so it was stored as Untitled Section.",
        },
      ],
    },
    {
      kind: "split-run",
      severity: "warning",
      class: "Check",
      title: "Split run",
      count: 1,
      open: true,
      issues: [
        {
          location: "Roof › Covering › Underlayment",
          sourceRow: 4,
          message: '"Covering" appears again as its own Item (row 4). An earlier run is row 2.',
        },
      ],
    },
    {
      kind: "editor-leftovers",
      severity: "notice",
      class: "Changed",
      title: "Editor leftovers removed",
      count: 400,
      open: false,
      issues: [{ location: "Roof › Flashing › Drip edge", sourceRow: 9, message: "1 editor leftover was removed from this Comment." }],
    },
    {
      kind: "whitespace-trimmed",
      severity: "notice",
      class: "Changed",
      title: "Whitespace trimmed",
      count: 0,
      open: false,
      issues: [],
    },
  ];
}

function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (value !== null && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value).some((item) => hasKey(item, key));
  }
  return false;
}

async function samplesReportGroups(): Promise<TrustIssueGroup[]> {
  const bytes = await writeXlsxFile([
    ["Section Name", "Item Name", "Comment Name", "Comment Text", "Comment Type (info, limit, defect)"],
    ["Roof", "Covering", "Shingles", "", "info"],
    ["Roof", "Flashing", "Drip edge", "", "info"],
    ["Roof", "Covering", "Underlayment", `<p style="background: url(https://evil.test/x)">t</p>`, "info"],
    ["", "Gutters", "Missing section", "", "info"],
  ]).toBuffer();
  const result = await parseSpectoraExport(bytes, "samples-warnings.xls");
  if (!result.ok) throw new Error(result.rejection.kind);
  return buildTrustReport(result.draft, result.draft.tree).issueGroups;
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
