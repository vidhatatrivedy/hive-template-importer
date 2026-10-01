import type { TrustReport } from "@/core/import/trust-report";
import { NOT_REVERIFIED, type ReportBase } from "@/app/report-base";

/** The Trust Report Summary's lines that need wording, from the report as it comes. */
export type TrustSummaryView = {
  versionLabel: string | null;
  fileSize: string;
  rowFlow: string;
  verdict: string;
  /** A ✓ in front of a full verdict. Off for a failure and for an unverifiable Copy. */
  marksVerdict: boolean;
  /** Set when a row failed. `sourceRows` holds null for a stored Comment that has no Source row. */
  failure: { message: string; sourceRows: (number | null)[] } | null;
};

export function trustSummaryView(
  report: TrustReport,
  latestNumber: number,
  baseKind: ReportBase["kind"] = "own-import",
): TrustSummaryView {
  const { summary } = report;
  const { verified, total } = summary.verdict;
  const unverifiable = baseKind === "unverifiable";
  const failed = unverifiable ? [] : report.rows.filter((row) => row.status === "✗");
  const failure =
    !unverifiable && verified < total
      ? {
          message: `✗ ${total - verified} of ${total} rows don't match what was stored. This is a bug in the importer.`,
          sourceRows: failed.map((row) => row.sourceRow),
        }
      : null;
  return {
    versionLabel:
      baseKind === "own-import" && latestNumber > 1
        ? `Describes Version 1, as imported. This Template is now at Version ${latestNumber}.`
        : null,
    fileSize: formatFileSize(summary.byteSize),
    rowFlow: `${summary.rowsRead} rows read → ${summary.blankRows} blank rows → ${summary.commentsStored} Comments stored`,
    verdict: unverifiable ? NOT_REVERIFIED : `${verified} / ${total} rows verified`,
    marksVerdict: !unverifiable && failure === null,
    failure,
  };
}

/** 1 KB = 1024 bytes, as the upload limit is defined. */
export function formatFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} ${byteSize === 1 ? "byte" : "bytes"}`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}
