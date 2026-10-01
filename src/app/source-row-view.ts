import { catalogueEntry, type IssueClass, type IssueSeverity } from "@/core/import/catalogue";
import type { Cell, Difference, DifferenceExplanation } from "@/core/import/reconcile";
import type { EditableTree, ImportEvidence } from "@/core/import/schemas";
import type { TrustReport } from "@/core/import/trust-report";
import { cutSegments, type Segment } from "@/app/cut-segments";

/** Slice 5's Comment detail uses this when a Comment has no Source row. */
export const ADDED_IN_THE_EDITOR = "Added in the editor, no Source row";

const COMMENT_TEXT = "Comment Text";

export type SourceRowField = {
  column: string;
  raw: string;
  stored: string;
  explanation: string;
};

export type SourceRowIssue = {
  severity: IssueSeverity;
  class: IssueClass;
  message: string;
};

export type SourceRowCell = {
  header: string;
  value: string;
};

export type SourceRowPresent = {
  kind: "row";
  row: number;
  title: string;
  /** "Section › Item › Comment" in the base Version. Null when no Comment carries this row. */
  location: string | null;
  fields: SourceRowField[];
  /** Set when the row check found no differences. */
  exact: string | null;
  issues: SourceRowIssue[];
  segments: Segment[];
  /** Set when the raw Comment Text has no cuts. */
  textNote: string | null;
  storedHtml: string;
  cells: SourceRowCell[];
};

export type SourceRowView = { kind: "missing"; message: string } | SourceRowPresent;

/**
 * What the Source row view shows for `row`. A blank row, the header, or any other
 * number that isn't a Source row of this import is missing.
 */
export function sourceRowView(
  report: TrustReport,
  evidence: ImportEvidence,
  tree: EditableTree,
  row: number,
): SourceRowView {
  const source = evidence.sourceRows.find((candidate) => candidate.rowNumber === row);
  if (!source) return { kind: "missing", message: `Row ${row} isn't a Source row of this import.` };

  const located = commentsOnRow(tree, row);
  const differences = report.rows.find((candidate) => candidate.sourceRow === row)?.differences ?? [];
  const issues: SourceRowIssue[] = [];
  const cuts: ImportEvidence["issues"][number]["cuts"] = [];
  for (const group of report.issueGroups) {
    for (const issue of group.issues) {
      if (issue.sourceRow !== row) continue;
      issues.push({ severity: group.severity, class: group.class, message: issue.message });
      cuts.push(...issue.cuts);
    }
  }

  const textColumn = evidence.run.headers.findIndex((header) => header.trim().toLowerCase() === COMMENT_TEXT.toLowerCase());
  const rawText = textColumn >= 0 ? cellString(source.cells[textColumn] ?? null) : "";
  const segments = cutSegments(rawText, cuts);

  return {
    kind: "row",
    row,
    title: `Source row ${row}`,
    location: located.location,
    fields: differences.map(showField),
    exact: differences.length === 0 ? "Stored exactly as in the file." : null,
    issues,
    segments,
    textNote: segments.some((segment) => segment.kind !== "kept") ? null : "No changes to the text.",
    storedHtml: located.storedHtml,
    cells: evidence.run.headers.map((header, index) => ({
      header,
      value: cellString(source.cells[index] ?? null),
    })),
  };
}

function commentsOnRow(tree: EditableTree, row: number): { location: string | null; storedHtml: string } {
  const locations: string[] = [];
  let storedHtml = "";
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        if (comment.sourceRow !== row) continue;
        locations.push(`${section.name} › ${item.name} › ${comment.name}`);
        if (locations.length === 1) storedHtml = comment.textHtml;
      }
    }
  }
  return { location: locations.length > 0 ? locations.join(" · ") : null, storedHtml };
}

function showField(difference: Difference): SourceRowField {
  return {
    column: difference.column,
    raw: showValue(difference.raw),
    stored: showValue(difference.stored),
    explanation: explanationOf(difference.explanation),
  };
}

/** A middle dot for each leading or trailing whitespace character, so a trim can be seen. */
function showValue(value: Cell): string {
  if (typeof value !== "string") return value === null ? "" : String(value);
  return value.replace(/^\s+|\s+$/g, (spaces) => "·".repeat(spaces.length));
}

function cellString(value: Cell): string {
  if (value === null) return "";
  return typeof value === "string" ? value : String(value);
}

function explanationOf(explanation: DifferenceExplanation | null): string {
  if (explanation === null) return "Unexplained";
  if ("rule" in explanation) return explanation.rule.replaceAll("-", " ");
  return explanation.issues.map((kind) => catalogueEntry(kind).title).join(", ");
}
