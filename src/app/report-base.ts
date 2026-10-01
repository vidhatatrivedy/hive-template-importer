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
    return { kind: "own-import", versionId: versionOneId(detail) };
  }
  const imported = summaries.find(
    (summary) => summary.creation === "import" && summary.importRun?.id === detail.importRun?.id,
  );
  if (imported) {
    return { kind: "source-import", templateId: imported.id, templateName: imported.name };
  }
  return { kind: "unverifiable", versionId: versionOneId(detail) };
}

/** Header line for a Copy. Null when this Template was not copied. */
export function copyHeaderLine(copiedFrom: CopiedFrom | null): string | null {
  if (!copiedFrom) return null;
  const deleted = copiedFrom.templateId === null ? " (deleted)" : "";
  return `Copy of '${copiedFrom.templateName}' v${copiedFrom.versionNumber}${deleted}`;
}

export const UNVERIFIABLE_EXPLANATION =
  "The Template this file was imported as has been deleted, so its rows can't be re-verified. Issues and locations below refer to this Copy's Version 1.";

/** What replaces the verdict when the imported Template is gone. No ✓ or ✗. */
export const NOT_REVERIFIED = "Not re-verified";

/** The Source row view's stored side, when locations come from this Copy's Version 1. */
export const STORED_IN_THIS_COPY = "in this Copy's Version 1";

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
  if (base.kind === "own-import") {
    return {
      movedOn:
        latestNumber > 1
          ? `Describes Version 1, as imported. This Template is now at Version ${latestNumber}.`
          : null,
      readOnly: null,
      unverifiable: null,
      copiedFrom: null,
    };
  }
  if (base.kind === "source-import") {
    return {
      movedOn: null,
      readOnly: {
        before: "Read-only. This is the import report of '",
        templateId: base.templateId,
        templateName: base.templateName,
        after: "', Version 1.",
      },
      unverifiable: null,
      copiedFrom: copiedFromLine(copiedFrom),
    };
  }
  if (base.kind === "unverifiable") {
    return {
      movedOn: null,
      readOnly: null,
      unverifiable: UNVERIFIABLE_EXPLANATION,
      copiedFrom: copiedFromLine(copiedFrom),
    };
  }
  return { movedOn: null, readOnly: null, unverifiable: null, copiedFrom: null };
}

function copiedFromLine(copiedFrom: CopiedFrom | null): string | null {
  if (!copiedFrom) return null;
  const deleted = copiedFrom.templateId === null ? " (deleted)" : "";
  return `Copied from '${copiedFrom.templateName}'${deleted}, Version ${copiedFrom.versionNumber}.`;
}

function versionOneId(detail: TemplateDetail): string {
  const version = detail.versions.find((candidate) => candidate.number === 1);
  if (!version) throw new Error("Template has no Version 1");
  return version.id;
}
