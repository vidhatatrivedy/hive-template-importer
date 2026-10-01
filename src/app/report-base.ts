import type { TemplateDetail, TemplateSummary } from "@/db/schemas";

/** Which stored Version the Trust Report reconciles against. */
export type ReportBase =
  | { kind: "own-import"; versionId: string }
  | { kind: "source-import"; templateId: string; templateName: string }
  | { kind: "unverifiable"; versionId: string }
  | { kind: "none" };

export type CopiedFrom = NonNullable<TemplateDetail["copiedFrom"]>;

/**
 * No Import run is `none`. An import uses its own Version 1. A Copy uses the imported
 * Template that still holds that run, or its own Version 1 once that Template is gone.
 */
export function resolveReportBase(
  detail: TemplateDetail,
  summaries: readonly TemplateSummary[],
): ReportBase {
  if (detail.importRun === null) return { kind: "none" };
  if (detail.creation === "import") {
    return { kind: "own-import", versionId: requireVersionOneId(detail) };
  }
  const importRunId = detail.importRun.id;
  const imported = summaries.find(
    (summary) => summary.creation === "import" && summary.importRun?.id === importRunId,
  );
  if (imported) {
    return { kind: "source-import", templateId: imported.id, templateName: imported.name };
  }
  return { kind: "unverifiable", versionId: requireVersionOneId(detail) };
}

/** Header line for a Copy. Null when this Template was not copied. */
export function copyHeaderLine(copiedFrom: CopiedFrom | null): string | null {
  if (!copiedFrom) return null;
  const deleted = deletedSuffix(copiedFrom.templateId);
  return `Copy of '${copiedFrom.templateName}' v${copiedFrom.versionNumber}${deleted}`;
}

export const UNVERIFIABLE_EXPLANATION =
  "The Template this file was imported as has been deleted, so its rows can't be re-verified. Issues and locations below refer to this Copy's Version 1.";

/** What replaces the verdict when the imported Template is gone. No ✓ or ✗. */
export const NOT_REVERIFIED = "Not re-verified";

/** The Source row view's stored side, when locations come from this Copy's Version 1. */
export const STORED_IN_THIS_COPY = "in this Copy's Version 1";

/** own-import, once this Template is past Version 1. Null at Version 1. */
export function movedOnLine(latestNumber: number): string | null {
  if (latestNumber <= 1) return null;
  return `Describes Version 1, as imported. This Template is now at Version ${latestNumber}.`;
}

/** Id of Version 1, or null when that Version is missing. */
export function findVersionOneId(versions: readonly { id: string; number: number }[]): string | null {
  return versions.find((version) => version.number === 1)?.id ?? null;
}

export type ReadOnlyLabel = {
  before: string;
  templateId: string;
  templateName: string;
  after: string;
};

/** The lines at the top of the Trust Report, and the text that replaces Reconciliation. */
export type ReportLabels = {
  /** own-import once this Template is past Version 1. */
  movedOn: string | null;
  /** source-import. The name links to the imported Template. */
  readOnly: ReadOnlyLabel | null;
  /** unverifiable. Also what stands in for Reconciliation. */
  unverifiable: string | null;
  copiedFrom: string | null;
};

export function reportLabels(base: ReportBase, latestNumber: number, copiedFrom: CopiedFrom | null): ReportLabels {
  switch (base.kind) {
    case "own-import":
      return { ...emptyLabels(), movedOn: movedOnLine(latestNumber) };
    case "source-import":
      return {
        ...emptyLabels(),
        readOnly: {
          before: "Read-only. This is the import report of '",
          templateId: base.templateId,
          templateName: base.templateName,
          after: "', Version 1.",
        },
        copiedFrom: copiedFromLine(copiedFrom),
      };
    case "unverifiable":
      return {
        ...emptyLabels(),
        unverifiable: UNVERIFIABLE_EXPLANATION,
        copiedFrom: copiedFromLine(copiedFrom),
      };
    case "none":
      return emptyLabels();
  }
}

function emptyLabels(): ReportLabels {
  return { movedOn: null, readOnly: null, unverifiable: null, copiedFrom: null };
}

function copiedFromLine(copiedFrom: CopiedFrom | null): string | null {
  if (!copiedFrom) return null;
  const deleted = deletedSuffix(copiedFrom.templateId);
  return `Copied from '${copiedFrom.templateName}'${deleted}, Version ${copiedFrom.versionNumber}.`;
}

function deletedSuffix(templateId: string | null): string {
  return templateId === null ? " (deleted)" : "";
}

function requireVersionOneId(detail: TemplateDetail): string {
  const id = findVersionOneId(detail.versions);
  if (id === null) throw new Error("Template has no Version 1");
  return id;
}
