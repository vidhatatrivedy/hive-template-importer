import "server-only";
import { cache } from "react";
import { buildTrustReport, type TrustReport } from "@/core/import/trust-report";
import type { EditableTree, ImportEvidence } from "@/core/import/schemas";
import type { Db, TemplateDetail } from "@/db";

/** One evidence read per request, shared by the editor's read-only fields and the Trust Report. */
export const getCachedImportEvidence = cache((db: Db, importRunId: string) =>
  db.getImportEvidence(importRunId),
);

export type LoadedTrustReport = {
  report: TrustReport;
  evidence: ImportEvidence;
  tree: EditableTree;
  importedAt: string;
  sha256: string;
};

/**
 * The Import Trust Report of an imported Template, recomputed from its stored Version 1 on every call.
 * Null when the Template has no report yet (a Copy or a Blank Template), or when the tree or the
 * evidence was deleted between reads.
 */
export async function loadTrustReport(db: Db, detail: TemplateDetail): Promise<LoadedTrustReport | null> {
  if (detail.creation !== "import" || !detail.importRun) return null;
  const version1 = detail.versions.find((version) => version.number === 1);
  if (!version1) return null;
  const [tree, evidence] = await Promise.all([
    db.getVersionTree(version1.id),
    getCachedImportEvidence(db, detail.importRun.id),
  ]);
  if (!tree || !evidence) return null;
  return {
    report: buildTrustReport(evidence, tree),
    evidence,
    tree,
    importedAt: detail.importRun.importedAt,
    sha256: detail.importRun.sha256,
  };
}
