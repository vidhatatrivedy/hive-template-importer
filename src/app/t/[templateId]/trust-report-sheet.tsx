import Link from "next/link";
import { issueClasses, issueSeverities } from "@/core/import/catalogue";
import { templateHref, withTrustPane, type TemplateView } from "@/app/template-view";
import { attachSourceRowLinks, importIssuesView } from "@/app/trust-issues";
import {
  countPhrase,
  trustSectionsView,
  type ExternalAssetHostView,
  type ExternalAssetsView,
  type KeptButNotUsedView,
  type MissingFromExportView,
  type ReconciliationRowView,
  type ReconciliationSectionView,
} from "@/app/trust-sections";
import { trustSummaryView } from "@/app/trust-summary";
import { glassSheetClass, labelClass, severityClass } from "@/app/ui/classes";
import { FormattedDate } from "@/app/ui/formatted-date";
import { ImportIssues } from "./import-issues";
import type { LoadedTrustReport } from "./load-trust-report";

const verdictClass = "font-medium text-neutral-900 dark:text-white";

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
  const summaryView = trustSummaryView(loaded.report, latestNumber);
  const { reconciliation, externalAssets, keptButNotUsed, missingFromExport } = trustSectionsView(loaded.report);
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
        {summaryView.versionLabel ? <p className="text-neutral-500">{summaryView.versionLabel}</p> : null}

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
            <dd>{summaryView.fileSize}</dd>
          </dl>
          <p>{summaryView.rowFlow}</p>
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
          {summaryView.failure ? (
            <div className="flex flex-col gap-1">
              <p className={verdictClass}>{summaryView.verdict}</p>
              <p className={verdictClass}>{summaryView.failure.message}</p>
              <ul className="flex flex-col">
                {summaryView.failure.sourceRows.map((row, index) => (
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
            <p className={verdictClass}>✓ {summaryView.verdict}</p>
          )}
        </section>

        <Reconciliation sections={reconciliation} />
        <ImportIssues
          key={templateId}
          severities={issueSeverities}
          classes={issueClasses}
          groups={attachSourceRowLinks(importIssuesView(loaded.report.issueGroups), rowHref)}
        />
        <ExternalAssets assets={externalAssets} rowHref={rowHref} />
        <KeptButNotUsed kept={keptButNotUsed} />
        <MissingFromExport missing={missingFromExport} />
      </div>
    </aside>
  );
}

function Reconciliation({ sections }: { sections: ReconciliationSectionView[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className={labelClass}>Reconciliation by Section</h3>
      {sections.map((section, index) => (
        <details
          key={`${section.row.name}-${index}`}
          className="border-b border-black/[0.05] py-1 last:border-b-0 dark:border-white/[0.06]"
        >
          <summary className="cursor-pointer">
            <ReconciliationRow row={section.row} />
          </summary>
          <div className="mt-1 flex flex-col pl-3">
            {section.items.map((item, itemIndex) => (
              <div key={`${item.name}-${itemIndex}`} className="py-1">
                <ReconciliationRow row={item} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

function ReconciliationRow({ row }: { row: ReconciliationRowView }) {
  return (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-neutral-900 dark:text-white">
          {row.name}
          {row.mark ? <span className="text-neutral-500"> · {row.mark}</span> : null}
        </span>
        <span className="shrink-0 text-neutral-900 dark:text-white">{row.status}</span>
      </span>
      <span className="block text-neutral-500">{row.counts}</span>
    </>
  );
}

type SourceRowHref = (row: number) => string;

function ExternalAssets({ assets, rowHref }: { assets: ExternalAssetsView; rowHref: SourceRowHref }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={labelClass}>External assets</h3>
      {assets.empty ? (
        <p>{assets.empty}</p>
      ) : (
        <>
          {assets.hosts.map((host) => (
            <ExternalAssetHost key={host.host} host={host} rowHref={rowHref} />
          ))}
          {assets.note ? <p className="text-neutral-500">{assets.note}</p> : null}
        </>
      )}
    </section>
  );
}

function ExternalAssetHost({ host, rowHref }: { host: ExternalAssetHostView; rowHref: SourceRowHref }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-neutral-900 dark:text-white">{host.host}</p>
      <ul className="flex flex-col gap-2">
        {host.urls.map((asset) => (
          <li key={asset.url} className="flex flex-col gap-0.5">
            <p className="break-all font-mono text-[11px] text-neutral-500">{asset.url}</p>
            <SourceRowLinks rows={asset.sourceRows} rowHref={rowHref} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceRowLinks({ rows, rowHref }: { rows: number[]; rowHref: SourceRowHref }) {
  if (rows.length === 0) return null;
  return (
    <p>
      {rows.map((row, index) => (
        <span key={row}>
          {index > 0 ? ", " : null}
          <Link href={rowHref(row)} className="underline underline-offset-2">
            Source row {row}
          </Link>
        </span>
      ))}
    </p>
  );
}

function KeptButNotUsed({ kept }: { kept: KeptButNotUsedView }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={labelClass}>Kept but not used</h3>
      <ul className="flex flex-col gap-0.5">
        {kept.columns.map((column) => (
          <li key={column.column}>
            {column.column}
            <span className="text-neutral-500"> · {countPhrase(column.rowsHoldingContent, "row", "rows")}</span>
          </li>
        ))}
      </ul>
      <p className="text-neutral-500">{kept.note}</p>
    </section>
  );
}

function MissingFromExport({ missing }: { missing: MissingFromExportView }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={labelClass}>Missing from export</h3>
      <ul className="flex flex-col gap-0.5">
        {missing.entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
      <ul className="flex flex-col text-neutral-500">
        {missing.counts.map((count) => (
          <li key={count.title}>
            {count.title} · {count.count}
          </li>
        ))}
      </ul>
    </section>
  );
}
