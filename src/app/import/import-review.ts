import { catalogueEntry, type IssueSeverity } from "@/core/import/catalogue";
import { countEditableTree, type ImportDraft } from "@/core/import/schemas";

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

export function toImportReview(draft: ImportDraft): ImportReview {
  const issueCounts: Record<IssueSeverity, number> = { warning: 0, notice: 0 };
  for (const issue of draft.issues) issueCounts[catalogueEntry(issue.kind).severity] += 1;
  return {
    filename: draft.run.filename,
    byteSize: draft.run.byteSize,
    sha256: draft.run.sha256,
    suggestedName: draft.suggestedName,
    counts: { rowsRead: draft.run.rowsRead, blankRows: draft.run.blankRows, ...countEditableTree(draft.tree) },
    issueCounts,
    previousImport: null,
  };
}
