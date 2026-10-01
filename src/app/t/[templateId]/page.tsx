import { connection } from "next/server";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/server";
import { parseTemplateView, type TemplateView } from "@/app/template-view";
import { glassClass } from "@/app/ui/classes";
import type { TemplateDetail } from "@/db/schemas";

export default async function TemplatePage({ params, searchParams }: PageProps<"/t/[templateId]">) {
  await connection();
  const { templateId } = await params;
  const view = parseTemplateView(await searchParams);
  if (!z.uuid().safeParse(templateId).success) notFound();

  const template = await getDb().getTemplate(templateId);
  if (!template) notFound();

  const latest = template.versions[0];
  if (!latest) throw new Error("Template has no Versions");
  const counts = formatCounts(latest.counts);

  return (
    <div className="flex h-full min-w-0 p-3">
      <div className={`${glassClass} relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl`}>
        <header className="flex h-11 shrink-0 items-center gap-4 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
          <h1 className="min-w-0 truncate font-medium text-neutral-900 dark:text-white">{template.name}</h1>
          <p className="shrink-0 text-neutral-500 tabular-nums">{counts}</p>
          {template.importRun ? (
            <p className="ml-auto max-w-[40%] truncate text-neutral-400">{template.importRun.filename}</p>
          ) : null}
        </header>
        <EditorSlot counts={counts} />
        <PaneHost view={view} />
      </div>
    </div>
  );
}

function formatCounts(counts: TemplateDetail["versions"][number]["counts"]): string {
  return `${counts.sections} Sections · ${counts.items} Items · ${counts.comments} Comments`;
}

/** Empty stand-in until the columns land. Nothing here is interactive. */
function EditorSlot({ counts }: { counts: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-neutral-500 tabular-nums">{counts}</div>
  );
}

/**
 * Sits outside the editor slot and is not keyed on the search params, so a later
 * editor keeps its unsaved edits when a sheet opens. Laid out for two sheets
 * (Versions, then Trust Report). No panes yet.
 */
function PaneHost({ view }: { view: TemplateView }) {
  return (
    <div
      className="absolute top-14 right-3 bottom-3 flex gap-2"
      data-row={view.row ?? undefined}
      data-panes={panesInOrder(view)}
    />
  );
}

function panesInOrder(view: TemplateView): string | undefined {
  const panes = (["versions", "trust"] as const).filter((pane) => view.panes.has(pane));
  return panes.length > 0 ? panes.join(",") : undefined;
}
