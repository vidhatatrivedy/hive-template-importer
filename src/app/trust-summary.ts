import type { TrustReport } from "@/core/import/trust-report";

/** The Trust Report Summary's lines that need wording, from the report as it comes. */
export type TrustSummaryView = {
  versionLabel: string | null;
  fileSize: string;
  rowFlow: string;
  verdict: string;
  /** Set when a row failed. `sourceRows` holds null for a stored Comment that has no Source row. */
  failure: { message: string; sourceRows: (number | null)[] } | null;
};

export function trustSummaryView(report: TrustReport, latestNumber: number): TrustSummaryView {
  const { summary } = report;
  const { verified, total } = summary.verdict;
  const failed = report.rows.filter((row) => row.status === "✗");
  return {
    versionLabel:
      latestNumber > 1
        ? `Describes Version 1, as imported. This Template is now at Version ${latestNumber}.`
        : null,
    fileSize: formatFileSize(summary.byteSize),
    rowFlow: `${summary.rowsRead} rows read → ${summary.blankRows} blank rows → ${summary.commentsStored} Comments stored`,
    verdict: `${verified} / ${total} rows verified`,
    failure:
      verified < total
        ? {
            message: `✗ ${total - verified} of ${total} rows don't match what was stored. This is a bug in the importer.`,
            sourceRows: failed.map((row) => row.sourceRow),
          }
        : null,
  };
}

/** 1 KB = 1024 bytes, as the upload limit is defined. */
export function formatFileSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} ${byteSize === 1 ? "byte" : "bytes"}`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}
