import "server-only";
import { cache } from "react";
import { buildTrustReport, type TrustReport } from "@/core/import/trust-report";
import type { EditableTree, ImportEvidence } from "@/core/import/schemas";
import { resolveReportBase, type ReportBase } from "@/app/report-base";
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
  base: Exclude<ReportBase, { kind: "none" }>;
};

/**
 * Which Version the report reconciles against. Lists Templates only for a Copy or a Blank,
 * never for an import: an import's base is its own Version 1.
 */
export async function loadReportBase(db: Db, detail: TemplateDetail): Promise<ReportBase> {
  const summaries = detail.creation === "import" ? [] : await db.listTemplates();
  return resolveReportBase(detail, summaries);
}

/**
 * The Import Trust Report, recomputed from the base Version on every call.
 * Null when the base is `none`, or when the tree or the evidence was deleted between reads.
 */
export async function loadTrustReport(
  db: Db,
  detail: TemplateDetail,
  base: ReportBase,
): Promise<LoadedTrustReport | null> {
  if (base.kind === "none" || !detail.importRun) return null;
  const versionId = await baseVersionId(db, base);
  if (!versionId) return null;
  const [tree, evidence] = await Promise.all([
    db.getVersionTree(versionId),
    getCachedImportEvidence(db, detail.importRun.id),
  ]);
  if (!tree || !evidence) return null;
  return {
    report: buildTrustReport(evidence, tree),
    evidence,
    tree,
    importedAt: detail.importRun.importedAt,
    sha256: detail.importRun.sha256,
    base,
  };
}

/** The imported Template's Version 1, or this Copy's own Version 1 when that Template is gone. */
async function baseVersionId(db: Db, base: Exclude<ReportBase, { kind: "none" }>): Promise<string | null> {
  if (base.kind === "source-import") {
    const imported = await db.getTemplate(base.templateId);
    return imported?.versions.find((version) => version.number === 1)?.id ?? null;
  }
  return base.versionId;
}
