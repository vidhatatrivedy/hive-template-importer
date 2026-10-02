import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import writeXlsxFile from "write-excel-file/node";
import { catalogue, issueClasses, issueKinds, issueSeverities, renderIssueMessage, type IssueKind } from "@/core/import/catalogue";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { rejectionKinds, rejectionMessage, type Rejection } from "@/core/import/rejections";
import { cutKinds, sanitiseCommentHtml, type CutKind } from "@/core/sanitise";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

/** One valid detail and the message it renders, for every catalogue kind. */
const KINDS: {
  kind: IssueKind;
  level: "file" | "row";
  severity: "warning" | "notice";
  class: "Changed" | "Unsupported" | "Missing from export" | "Check";
  title: string;
  detail: unknown;
  message: string;
}[] = [
  {
    kind: "expected-column-missing",
    level: "file",
    severity: "warning",
    class: "Missing from export",
    title: "Expected column missing",
    detail: { column: "Default Location" },
    message: "Default Location wasn't in this export, so it was left empty.",
  },
  {
    kind: "unknown-column",
    level: "file",
    severity: "notice",
    class: "Unsupported",
    title: "Unknown column",
    detail: { header: "Notes", column: 43 },
    message: `Column 43 ("Notes") wasn't used. Its cells were kept in the Source row.`,
  },
  {
    kind: "extra-sheet",
    level: "file",
    severity: "warning",
    class: "Unsupported",
    title: "Extra sheet",
    detail: { sheets: ["Sheet2"] },
    message: `The sheet "Sheet2" wasn't read. Only the first sheet was imported.`,
  },
  {
    kind: "raw-only-content",
    level: "file",
    severity: "notice",
    class: "Unsupported",
    title: "Raw-only content",
    detail: { column: "Uses", rows: [4] },
    message: "Uses has content on row 4; kept in the Source row, not shown in the editor.",
  },
  {
    kind: "custom-estimates",
    level: "file",
    severity: "warning",
    class: "Unsupported",
    title: "Custom estimates",
    detail: { rows: [8] },
    message: "A custom estimate on row 8 was kept in the Source row, not shown in the editor.",
  },
  {
    kind: "stock-estimates",
    level: "file",
    severity: "notice",
    class: "Unsupported",
    title: "Stock estimates",
    detail: { count: 392 },
    message: "Spectora's stock estimate on all 392 Comments; not imported.",
  },
  {
    kind: "whitespace-trimmed",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Whitespace trimmed",
    detail: { field: "Item Name" },
    message: "Leading and trailing spaces were removed from Item Name.",
  },
  {
    kind: "vocabulary-normalised",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Vocabulary normalised",
    detail: { field: "Comment Type (info, limit, defect)" },
    message: "Comment Type was re-cased or trimmed.",
  },
  {
    kind: "boolean-default-normalised",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Boolean default normalised",
    detail: { value: false },
    message: "Default Value was stored as no.",
  },
  {
    kind: "boolean-default-invalid",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Boolean default invalid",
    detail: {},
    message: "Default Value wasn't a yes/no value, so none was stored.",
  },
  {
    kind: "comment-type-fallback",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Comment type not recognised",
    detail: {},
    message: "Comment Type was blank or not a known value, so it was stored as Informational.",
  },
  {
    kind: "answer-type-fallback",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Answer type not recognised",
    detail: {},
    message: "Answer Type was blank or not a known value, so it was stored as yes/no.",
  },
  {
    kind: "category-missing",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Category missing",
    detail: {},
    message: "This defect has no valid Category, so none was stored.",
  },
  {
    kind: "category-orphan",
    level: "row",
    severity: "notice",
    class: "Check",
    title: "Category kept",
    detail: { category: 1 },
    message: "Category 1 was kept on an Informational or Limitation Comment.",
  },
  {
    kind: "blank-name",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Blank name",
    detail: { field: "Comment Name" },
    message: "Comment Name was blank, so it was stored as Untitled Comment.",
  },
  {
    kind: "checkbox-default-not-in-options",
    level: "row",
    severity: "notice",
    class: "Check",
    title: "Checkbox default not in options",
    detail: { value: "Maybe" },
    message: `Default Value "Maybe" isn't one of the choice options.`,
  },
  {
    kind: "empty-option-dropped",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Empty option dropped",
    detail: { field: "Multiple Choice Options (comma-separated)" },
    message: "An empty entry was dropped from Multiple Choice Options.",
  },
  {
    kind: "options-orphan",
    level: "row",
    severity: "notice",
    class: "Check",
    title: "Choice options kept",
    detail: {},
    message: "Choice options were kept on a Comment that isn't a checkbox.",
  },
  {
    kind: "split-run",
    level: "row",
    severity: "warning",
    class: "Check",
    title: "Split run",
    detail: { level: "section", name: "Roof", firstRow: 10, lastRow: 12, earlierRuns: [{ firstRow: 2, lastRow: 4 }] },
    message: `"Roof" appears again as its own Section (rows 10-12). An earlier run is rows 2-4.`,
  },
  {
    kind: "duplicate-comment",
    level: "row",
    severity: "notice",
    class: "Check",
    title: "Duplicate comment",
    detail: { name: "Leak", commentType: "info", rows: [2, 3] },
    message: `"Leak" (Informational) is repeated on rows 2 and 3. Each one was kept.`,
  },
  {
    kind: "editor-leftovers",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Editor leftovers removed",
    detail: { count: 2 },
    message: "2 editor leftovers were removed from this Comment.",
  },
  {
    kind: "attribute-removed",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Attribute removed",
    detail: { tag: "img", attribute: "onerror" },
    message: "The onerror attribute was removed from <img>.",
  },
  {
    kind: "tag-unwrapped",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Tag unwrapped",
    detail: { tag: "font" },
    message: "A <font> tag was removed and its text was kept.",
  },
  {
    kind: "style-unparseable",
    level: "row",
    severity: "notice",
    class: "Changed",
    title: "Unparseable style removed",
    detail: { tag: "p" },
    message: "A style attribute on <p> could not be parsed and was removed.",
  },
  {
    kind: "tag-removed",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Tag removed",
    detail: { tag: "script" },
    message: "A <script> tag was removed along with its content.",
  },
  {
    kind: "link-scheme-removed",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Link scheme removed",
    detail: { tag: "a" },
    message: "An address on <a> was removed because its scheme is not allowed.",
  },
  {
    kind: "iframe-to-link",
    level: "row",
    severity: "warning",
    class: "Unsupported",
    title: "Non-YouTube iframe turned into a link",
    detail: {},
    message: "An embedded frame from another site was turned into a link.",
  },
  {
    kind: "markup-rebuilt",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Markup rebuilt",
    detail: {},
    message: "This Comment's markup was rebuilt. Check it closely.",
  },
  {
    kind: "youtube-wrapper-empty",
    level: "row",
    severity: "warning",
    class: "Missing from export",
    title: "Empty YouTube wrapper",
    detail: {},
    message: "An empty YouTube wrapper was removed. The video was not in the export.",
  },
  {
    kind: "unsafe-style-removed",
    level: "row",
    severity: "warning",
    class: "Changed",
    title: "Unsafe style removed",
    detail: { tag: "p", property: "background" },
    message: "A background style on <p> was removed because its value could load remote content or run code.",
  },
];

const REJECTIONS: Rejection[] = [
  { kind: "too-large", byteSize: 5_000_000, limit: 4_194_304 },
  { kind: "not-xlsx" },
  { kind: "unreadable-xlsx" },
  { kind: "no-data-rows" },
  { kind: "missing-columns", missing: ["Item Name", "Comment Type"] },
  { kind: "plain-text-export" },
];

/** HTML that produces one cut kind, and the Import issue that cut must land on. */
const CUT_SAMPLES: { cutKind: CutKind; issueKind: IssueKind; html: string }[] = [
  { cutKind: "editor-leftover", issueKind: "editor-leftovers", html: `<p fr-original-style="x">t</p>` },
  { cutKind: "attribute-removed", issueKind: "attribute-removed", html: `<img src="https://cdn.spectora.com/x.jpg" onerror="alert(1)">` },
  { cutKind: "css-property-removed", issueKind: "editor-leftovers", html: `<p style="position: fixed">t</p>` },
  { cutKind: "css-property-removed", issueKind: "unsafe-style-removed", html: `<p style="background: url(https://evil.test/x)">t</p>` },
  { cutKind: "style-unparseable", issueKind: "style-unparseable", html: `<p style="color: red; font-weight">t</p>` },
  { cutKind: "tag-removed", issueKind: "tag-removed", html: "<script>alert(1)</script>" },
  { cutKind: "tag-unwrapped", issueKind: "tag-unwrapped", html: `<p>Keep <font color="red">these words</font> here</p>` },
  { cutKind: "link-scheme-removed", issueKind: "link-scheme-removed", html: `<a href="javascript:alert(1)">this</a>` },
  { cutKind: "iframe-to-link", issueKind: "iframe-to-link", html: `<iframe src="https://example.org/page"></iframe>` },
  { cutKind: "youtube-wrapper-emptied", issueKind: "youtube-wrapper-empty", html: `<div class="youtube-embed-wrapper"></div>` },
  { cutKind: "markup-rebuilt", issueKind: "markup-rebuilt", html: `${"<div>".repeat(600)}words` },
];

describe("catalogue completeness", () => {
  it("exports exactly 30 kinds, each with a level, severity, class, title, detail schema and message", () => {
    expect(issueKinds).toHaveLength(30);
    expect(issueKinds).toContain("attribute-removed");
    expect(issueKinds).toEqual(KINDS.map((row) => row.kind));
    expect(catalogue.map((entry) => entry.kind)).toEqual([...issueKinds]);
    expect(issueSeverities).toEqual(["warning", "notice"]);
    expect(issueClasses).toEqual(["Changed", "Unsupported", "Missing from export", "Check"]);
    expect(cutKinds).toEqual([
      "editor-leftover",
      "attribute-removed",
      "css-property-removed",
      "style-unparseable",
      "tag-removed",
      "tag-unwrapped",
      "link-scheme-removed",
      "iframe-to-link",
      "youtube-wrapper-emptied",
      "markup-rebuilt",
    ]);

    for (const row of KINDS) {
      const entry = catalogue.find((candidate) => candidate.kind === row.kind);
      expect(entry, row.kind).toMatchObject({
        level: row.level,
        severity: row.severity,
        class: row.class,
        title: row.title,
      });
      expect(entry?.detail.safeParse(row.detail).success, row.kind).toBe(true);
      expect(entry?.detail.safeParse(null).success, row.kind).toBe(false);
      expect(renderIssueMessage(row.kind, row.detail), row.kind).toBe(row.message);
    }
  });

  it("gives every rejection kind a message", () => {
    expect(rejectionKinds).toEqual(REJECTIONS.map((rejection) => rejection.kind));
    for (const rejection of REJECTIONS) {
      expect(rejectionMessage(rejection).trim().length, rejection.kind).toBeGreaterThan(0);
    }
  });

  it("maps every cut kind onto an issue kind", async () => {
    expect(new Set(CUT_SAMPLES.map((sample) => sample.cutKind))).toEqual(new Set(cutKinds));

    const headers = ["Section Name", "Item Name", "Comment Name", "Comment Text", "Comment Type (info, limit, defect)"];
    const rows = CUT_SAMPLES.map((sample, index) => ["Section", "Item", `Comment ${index + 1}`, sample.html, "info"]);
    const bytes = new Uint8Array(await writeXlsxFile([headers, ...rows]).toBuffer());
    const result = await parseSpectoraExport(bytes, "cuts.xls");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    CUT_SAMPLES.forEach((sample, index) => {
      const sourceRow = index + 2;
      const cuts = sanitiseCommentHtml(sample.html).cuts.filter((cut) => cut.kind === sample.cutKind);
      expect(cuts.length, sample.cutKind).toBeGreaterThan(0);
      for (const cut of cuts) {
        const owners = result.draft.issues.filter(
          (issue) =>
            issue.sourceRow === sourceRow &&
            issue.cuts.some((logged) => logged.start === cut.start && logged.kind === cut.kind),
        );
        expect(owners, `${sample.cutKind}@${cut.start}`).toHaveLength(1);
        expect(owners[0]?.kind, `${sample.cutKind} → ${sample.issueKind}`).toBe(sample.issueKind);
      }
    });
  });

  it("validates every issue in every fixture draft against its kind's detail schema", async () => {
    const files = fs.readdirSync(FIXTURE_DIR).filter((file) => file.endsWith(".xls") && !file.includes("(plain text)"));
    for (const file of files) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, file)));
      const result = await parseSpectoraExport(bytes, file);
      expect(result.ok, file).toBe(true);
      if (!result.ok) continue;
      for (const issue of result.draft.issues) {
        const entry = catalogue.find((candidate) => candidate.kind === issue.kind);
        expect(entry, `${file} ${issue.kind}`).toBeDefined();
        const parsed = entry?.detail.safeParse(issue.detail);
        expect(parsed?.success, `${file} ${issue.kind} row ${issue.sourceRow}`).toBe(true);
      }
    }
  });
});
