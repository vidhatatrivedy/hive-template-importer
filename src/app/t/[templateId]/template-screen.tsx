import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { getDb } from "@/db/server";
import {
  parseTemplateView,
  templateHref,
  withTrustPane,
  withVersionsPane,
  type TemplateSearchParams,
  type TemplateView,
} from "@/app/template-view";
import { versionLabel } from "@/app/version-label";
import { GuardedLink } from "@/app/unsaved-guard";
import { buttonClass, glassClass } from "@/app/ui/classes";
import { readOnlyFields } from "@/core/import/read-only-fields";
import { Editor } from "./editor";
import { getCachedImportEvidence, loadTrustReport } from "./load-trust-report";
import { TrustReportSheet } from "./trust-report-sheet";
import { VersionBanner } from "./version-banner";
import { formatVersionCounts, VersionsSheet } from "./versions-sheet";

/**
 * The editor, or the same shell on an old Version. `requestedVersion` null is the latest
 * Version, editable. A number that is the latest redirects there; any other Version is read-only.
 */
export async function TemplateScreen({
  templateId,
  searchParams,
  requestedVersion,
}: {
  templateId: string;
  searchParams: Promise<TemplateSearchParams>;
  requestedVersion: number | null;
}) {
  await connection();
  const view = parseTemplateView(await searchParams);
  if (!z.uuid().safeParse(templateId).success) notFound();

  const db = getDb();
  const template = await db.getTemplate(templateId);
  if (!template) notFound();

  const latest = template.versions.find((version) => version.number === template.latest.number);
  if (!latest) throw new Error("Template has no Versions");

  if (requestedVersion !== null && requestedVersion === latest.number) {
    redirect(templateHref(template.id, view));
  }

  const viewed =
    requestedVersion === null
      ? latest
      : template.versions.find((version) => version.number === requestedVersion);
  if (!viewed) notFound();

  const tree = await db.getVersionTree(viewed.id);
  if (!tree) notFound();

  const readOnly = requestedVersion !== null;
  const hrefVersion = readOnly ? viewed.number : null;
  const counts = formatVersionCounts(viewed.counts);
  const hasReport = template.creation === "import";
  const trustOpen = hasReport && view.panes.has("trust");
  const versionsOpen = view.panes.has("versions");
  // Start evidence before the Trust Report so both share one cached read, and the report's tree fetch overlaps it.
  const evidencePromise = template.importRun
    ? getCachedImportEvidence(db, template.importRun.id)
    : Promise.resolve(null);
  const trust = trustOpen ? await loadTrustReport(db, template) : null;
  const evidence = await evidencePromise;
  if (trustOpen && !trust) notFound();

  return (
    <div className="flex h-full min-w-0 p-3">
      <div className={`${glassClass} relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl`}>
        <Editor
          templateId={template.id}
          templateName={template.name}
          versionId={viewed.id}
          versionNumber={viewed.number}
          tree={tree}
          row={view.row}
          versionsOpen={versionsOpen}
          counts={counts}
          mode={readOnly ? "read-only" : "edit"}
          hrefVersion={hrefVersion}
          readOnlyFields={evidence ? readOnlyFields(evidence) : {}}
          banner={
            readOnly ? (
              <VersionBanner
                templateId={template.id}
                versionId={viewed.id}
                number={viewed.number}
                latestNumber={latest.number}
                label={versionLabel(viewed, template)}
                savedAt={viewed.savedAt}
                panes={view.panes}
              />
            ) : null
          }
        >
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {template.importRun ? (
              <p className="max-w-56 truncate text-neutral-400">{template.importRun.filename}</p>
            ) : null}
            {hasReport ? (
              <GuardedLink
                href={templateHref(template.id, withTrustPane(view, !trustOpen), { version: hrefVersion })}
                aria-current={trustOpen ? "true" : undefined}
                className={`${buttonClass} shrink-0 ${trustOpen ? "bg-black/[0.06] dark:bg-white/[0.1]" : ""}`}
              >
                Trust Report
              </GuardedLink>
            ) : null}
            <GuardedLink
              href={templateHref(template.id, withVersionsPane(view, !versionsOpen), { version: hrefVersion })}
              aria-current={versionsOpen ? "true" : undefined}
              className={`${buttonClass} shrink-0 ${versionsOpen ? "bg-black/[0.06] dark:bg-white/[0.1]" : ""}`}
            >
              Versions
            </GuardedLink>
          </div>
        </Editor>
        <PaneHost view={view} belowBanner={readOnly}>
          {versionsOpen ? (
            <VersionsSheet
              templateId={template.id}
              view={view}
              detail={template}
              viewingNumber={hrefVersion}
            />
          ) : null}
          {trust ? (
            <TrustReportSheet
              templateId={template.id}
              view={view}
              latestNumber={latest.number}
              loaded={trust}
              hrefVersion={hrefVersion}
            />
          ) : null}
        </PaneHost>
      </div>
    </div>
  );
}

/**
 * Sits outside the editor and is not keyed on the search params, so the editor
 * keeps its selection when a sheet opens. Versions, then the Trust Report.
 * The banner on an old Version sits under the header, so the sheets start below it.
 */
function PaneHost({
  view,
  belowBanner,
  children,
}: {
  view: TemplateView;
  belowBanner: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute right-3 bottom-3 flex gap-2 ${belowBanner ? "top-24" : "top-14"}`}
      data-row={view.row ?? undefined}
      data-panes={panesInOrder(view)}
    >
      {children}
    </div>
  );
}

function panesInOrder(view: TemplateView): string | undefined {
  const panes = (["versions", "trust"] as const).filter((pane) => view.panes.has(pane));
  return panes.length > 0 ? panes.join(",") : undefined;
}
