import { catalogueEntry, issueKinds, renderIssueMessage, type IssueKind, type IssueSeverity } from "@/core/import/catalogue";
import { countEditableTree, type ImportDraft, type ImportIssue } from "@/core/import/schemas";
import type { TemplateSummary } from "@/db/schemas";
import type { ReviewTooltip } from "@/app/import/review-tooltip";

const TOOLTIP_CAP = 6;

/** Everything the Import review shows, and nothing more: no Source rows, no tree. */
export type ImportReview = {
  filename: string;
  byteSize: number;
  sha256: string;
  suggestedName: string;
  counts: { rowsRead: number; blankRows: number; sections: number; items: number; comments: number };
  issueCounts: Record<IssueSeverity, number>;
  /** At most six warning lines, in file order, plus how many warnings did not fit. */
  warnings: ReviewTooltip;
  /** At most six notice kinds, plus how many kinds did not fit. */
  notices: ReviewTooltip;
  previousImport: { templateId: string; name: string; importedAt: string } | null;
};

export function toImportReview(draft: ImportDraft, summaries: TemplateSummary[]): ImportReview {
  const issueCounts: Record<IssueSeverity, number> = { warning: 0, notice: 0 };
  const warningIssues: ImportIssue[] = [];
  const noticeCounts = new Map<IssueKind, number>();
  for (const issue of draft.issues) {
    const entry = catalogueEntry(issue.kind);
    issueCounts[entry.severity] += 1;
    if (entry.severity === "warning") warningIssues.push(issue);
    else noticeCounts.set(issue.kind, (noticeCounts.get(issue.kind) ?? 0) + 1);
  }
  const locations = locationsOf(draft.tree);
  return {
    filename: draft.run.filename,
    byteSize: draft.run.byteSize,
    sha256: draft.run.sha256,
    suggestedName: draft.suggestedName,
    counts: { rowsRead: draft.run.rowsRead, blankRows: draft.run.blankRows, ...countEditableTree(draft.tree) },
    issueCounts,
    warnings: warningTooltip(warningIssues, locations),
    notices: noticeTooltip(noticeCounts),
    previousImport: previousImport(draft.run.sha256, summaries),
  };
}

/**
 * A title that names the change stands alone. When the detail distinguishes one
 * warning from another, the line uses the rendered message instead.
 */
function warningTooltip(issues: readonly ImportIssue[], locations: ReadonlyMap<number, string>): ReviewTooltip {
  return {
    lines: issues.slice(0, TOOLTIP_CAP).map((issue) => warningLine(issue, locations)),
    more: Math.max(0, issues.length - TOOLTIP_CAP),
  };
}

function warningLine(issue: ImportIssue, locations: ReadonlyMap<number, string>): string {
  const entry = catalogueEntry(issue.kind);
  const label = hasDetail(issue.detail) ? renderIssueMessage(issue.kind, issue.detail) : entry.title;
  return `${label} · ${warningPlace(issue, locations)}`;
}

function hasDetail(detail: unknown): boolean {
  return typeof detail === "object" && detail !== null && Object.keys(detail).length > 0;
}

function warningPlace(issue: ImportIssue, locations: ReadonlyMap<number, string>): string {
  const entry = catalogueEntry(issue.kind);
  if (entry.level === "file" || issue.sourceRow === null) return "File";
  const where = locations.get(issue.sourceRow);
  return where === undefined ? `row ${issue.sourceRow}` : `${where} (row ${issue.sourceRow})`;
}

function noticeTooltip(counts: ReadonlyMap<IssueKind, number>): ReviewTooltip {
  const ranked = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return issueKinds.indexOf(left[0]) - issueKinds.indexOf(right[0]);
  });
  return {
    lines: ranked.slice(0, TOOLTIP_CAP).map(([kind, count]) => `${catalogueEntry(kind).title} ×${count}`),
    more: Math.max(0, ranked.length - TOOLTIP_CAP),
  };
}

function locationsOf(tree: ImportDraft["tree"]): Map<number, string> {
  const locations = new Map<number, string>();
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        if (comment.sourceRow === null || locations.has(comment.sourceRow)) continue;
        locations.set(comment.sourceRow, `${section.name} › ${item.name} › ${comment.name}`);
      }
    }
  }
  return locations;
}

/** The imported Template with this file's hash and the latest import time. A Copy never matches. */
function previousImport(sha256: string, summaries: readonly TemplateSummary[]): ImportReview["previousImport"] {
  let chosen: ImportReview["previousImport"] = null;
  for (const summary of summaries) {
    const run = summary.importRun;
    if (summary.creation !== "import" || run === null || run.sha256 !== sha256) continue;
    if (chosen !== null && Date.parse(run.importedAt) <= Date.parse(chosen.importedAt)) continue;
    chosen = { templateId: summary.id, name: summary.name, importedAt: run.importedAt };
  }
  return chosen;
}
