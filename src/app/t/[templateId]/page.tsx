import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { getDb } from "@/db/server";
import { parseTemplateView, templateHref, withTrustPane, type TemplateView } from "@/app/template-view";
import { GuardedLink } from "@/app/unsaved-guard";
import { buttonClass, glassClass } from "@/app/ui/classes";
import type { TemplateDetail } from "@/db/schemas";
import { Editor } from "./editor";
import { loadTrustReport } from "./load-trust-report";
import { TrustReportSheet } from "./trust-report-sheet";

export default async function TemplatePage({ params, searchParams }: PageProps<"/t/[templateId]">) {
  await connection();
  const { templateId } = await params;
  const view = parseTemplateView(await searchParams);
  if (!z.uuid().safeParse(templateId).success) notFound();

  const db = getDb();
  const template = await db.getTemplate(templateId);
  if (!template) notFound();

  const latest = template.versions[0];
  if (!latest) throw new Error("Template has no Versions");
  const tree = await db.getVersionTree(latest.id);
  if (!tree) notFound();
  const counts = formatCounts(latest.counts);
  const hasReport = template.creation === "import";
  const trustOpen = hasReport && view.panes.has("trust");
  const trust = trustOpen ? await loadTrustReport(db, template) : null;
  if (trustOpen && !trust) notFound();

  return (
    <div className="flex h-full min-w-0 p-3">
      <div className={`${glassClass} relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl`}>
        <Editor
          templateId={template.id}
          templateName={template.name}
          versionId={latest.id}
          versionNumber={latest.number}
          tree={tree}
          row={view.row}
          versionsOpen={view.panes.has("versions")}
          counts={counts}
        >
          {template.importRun ? (
            <p className="ml-auto max-w-[40%] truncate text-neutral-400">{template.importRun.filename}</p>
          ) : null}
          {hasReport ? (
            <GuardedLink
              href={templateHref(template.id, withTrustPane(view, !trustOpen))}
              aria-current={trustOpen ? "true" : undefined}
              className={`${buttonClass} shrink-0 ${trustOpen ? "bg-black/[0.06] dark:bg-white/[0.1]" : ""}`}
            >
              Trust Report
            </GuardedLink>
          ) : null}
        </Editor>
        <PaneHost view={view}>
          {trust ? (
            <TrustReportSheet templateId={template.id} view={view} latestNumber={latest.number} loaded={trust} />
          ) : null}
        </PaneHost>
      </div>
    </div>
  );
}

function formatCounts(counts: TemplateDetail["versions"][number]["counts"]): string {
  return `${counts.sections} Sections · ${counts.items} Items · ${counts.comments} Comments`;
}

/**
 * Sits outside the editor and is not keyed on the search params, so the editor
 * keeps its selection when a sheet opens. Laid out for two sheets
 * (Versions, then Trust Report).
 */
function PaneHost({ view, children }: { view: TemplateView; children: ReactNode }) {
  return (
    <div
      className="absolute top-14 right-3 bottom-3 flex gap-2"
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
