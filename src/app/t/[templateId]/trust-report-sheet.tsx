import Link from "next/link";
import { issueClasses, issueSeverities, type IssueSeverity } from "@/core/import/catalogue";
import { templateHref, withTrustPane, type TemplateView } from "@/app/template-view";
import { trustSummaryView } from "@/app/trust-summary";
import { glassSheetClass, labelClass, severityNoticeClass, severityWarningClass } from "@/app/ui/classes";
import { FormattedDate } from "@/app/ui/formatted-date";
import type { LoadedTrustReport } from "./load-trust-report";

const severityClass: Record<IssueSeverity, string> = {
  warning: severityWarningClass,
  notice: severityNoticeClass,
};

/** The Import Trust Report sheet. Renders the report data as it comes. */
export function TrustReportSheet({
  templateId,
  view,
  latestNumber,
  loaded,
}: {
  templateId: string;
  view: TemplateView;
  latestNumber: number;
  loaded: LoadedTrustReport;
}) {
  const { summary } = loaded.report;
  const text = trustSummaryView(loaded.report, latestNumber);
  const rowHref = (row: number) => templateHref(templateId, { ...withTrustPane(view, true), row });

  return (
    <aside
      aria-label="Import Trust Report"
      className={`${glassSheetClass} flex w-[392px] flex-col overflow-hidden rounded-xl tabular-nums`}
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
        <h2 className="font-medium text-neutral-900 dark:text-white">Import Trust Report</h2>
        <Link
          href={templateHref(templateId, withTrustPane(view, false))}
          aria-label="Close the Trust Report"
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          ×
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        {text.versionLabel ? <p className="text-neutral-500">{text.versionLabel}</p> : null}

        <section className="flex flex-col gap-2">
          <h3 className={labelClass}>Summary</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-neutral-500">File</dt>
            <dd className="min-w-0 truncate" title={summary.filename}>
              {summary.filename}
            </dd>
            <dt className="text-neutral-500">Imported</dt>
            <dd>
              <FormattedDate value={loaded.importedAt} />
            </dd>
            <dt className="text-neutral-500">SHA-256</dt>
            <dd>
              <abbr title={loaded.sha256} className="font-mono no-underline">
                {summary.sha256}
              </abbr>
            </dd>
            <dt className="text-neutral-500">Size</dt>
            <dd>{text.fileSize}</dd>
          </dl>
          <p>{text.rowFlow}</p>
          <p>
            {summary.sections} Sections · {summary.items} Items · {summary.comments} Comments
          </p>
          <ul className="flex flex-wrap gap-x-3">
            {issueSeverities.map((severity) => (
              <li key={severity} className={severityClass[severity]}>
                {summary.bySeverity[severity]} {summary.bySeverity[severity] === 1 ? severity : `${severity}s`}
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-3 text-neutral-500">
            {issueClasses.map((issueClass) => (
              <li key={issueClass}>
                {summary.byClass[issueClass]} {issueClass}
              </li>
            ))}
          </ul>
          <p>{summary.valuesDecoded} values decoded</p>
          {text.failure ? (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-neutral-900 dark:text-white">{text.verdict}</p>
              <p className="font-medium text-neutral-900 dark:text-white">{text.failure.message}</p>
              <ul className="flex flex-col">
                {text.failure.sourceRows.map((row, index) => (
                  <li key={row ?? `none-${index}`}>
                    {row === null ? (
                      <span className="text-neutral-500">A stored Comment with no Source row</span>
                    ) : (
                      <Link href={rowHref(row)} className="underline underline-offset-2">
                        Source row {row}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="font-medium text-neutral-900 dark:text-white">✓ {text.verdict}</p>
          )}
        </section>
      </div>
    </aside>
  );
}
