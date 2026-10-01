import { catalogueEntry, type IssueSeverity } from "@/core/import/catalogue";
import { countEditableTree, type ImportDraft } from "@/core/import/schemas";
import type { TemplateSummary } from "@/db/schemas";

/** Everything the Import review shows, and nothing more: no Source rows, no tree. */
export type ImportReview = {
  filename: string;
  byteSize: number;
  sha256: string;
  suggestedName: string;
  counts: { rowsRead: number; blankRows: number; sections: number; items: number; comments: number };
  issueCounts: Record<IssueSeverity, number>;
  previousImport: { templateId: string; name: string; importedAt: string } | null;
};

export function toImportReview(draft: ImportDraft, summaries: TemplateSummary[]): ImportReview {
  const issueCounts: Record<IssueSeverity, number> = { warning: 0, notice: 0 };
  for (const issue of draft.issues) issueCounts[catalogueEntry(issue.kind).severity] += 1;
  return {
    filename: draft.run.filename,
    byteSize: draft.run.byteSize,
    sha256: draft.run.sha256,
    suggestedName: draft.suggestedName,
    counts: { rowsRead: draft.run.rowsRead, blankRows: draft.run.blankRows, ...countEditableTree(draft.tree) },
    issueCounts,
    previousImport: previousImport(draft.run.sha256, summaries),
  };
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
