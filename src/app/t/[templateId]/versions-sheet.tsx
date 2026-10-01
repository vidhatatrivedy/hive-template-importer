import type { TemplateDetail } from "@/db/schemas";
import { templateHref, withVersionsPane, type TemplateView } from "@/app/template-view";
import { versionLabel } from "@/app/version-label";
import { GuardedLink } from "@/app/unsaved-guard";
import { glassSheetClass, rowActiveClass, rowIdleClass } from "@/app/ui/classes";
import { FormattedDate } from "@/app/ui/formatted-date";

/** "13 Sections · 69 Items · 392 Comments", the header and each Version row. */
export function formatVersionCounts(counts: TemplateDetail["versions"][number]["counts"]): string {
  return `${counts.sections} Sections · ${counts.items} Items · ${counts.comments} Comments`;
}

/**
 * Every Version of this Template, newest first. The latest row opens the editor;
 * an older row opens that Version read-only. `viewingNumber` is set on that view.
 */
export function VersionsSheet({
  templateId,
  view,
  detail,
  viewingNumber,
}: {
  templateId: string;
  view: TemplateView;
  detail: TemplateDetail;
  viewingNumber: number | null;
}) {
  const closeHref = templateHref(
    templateId,
    withVersionsPane(view, false),
    viewingNumber === null ? undefined : { version: viewingNumber },
  );
  const versions = detail.versions.slice().sort((left, right) => right.number - left.number);
  const rowView = { panes: view.panes, row: null };

  return (
    <aside
      aria-label="Versions"
      className={`${glassSheetClass} flex w-[260px] flex-col overflow-hidden rounded-xl`}
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-black/[0.05] px-3 dark:border-white/[0.06]">
        <h2 className="font-medium text-neutral-900 dark:text-white">Versions</h2>
        <GuardedLink
          href={closeHref}
          aria-label="Close Versions"
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          ×
        </GuardedLink>
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 py-1.5">
        {versions.map((version) => {
          const current = version.number === detail.latest.number;
          const viewing = viewingNumber === version.number;
          const here = viewing || (viewingNumber === null && current);
          const href = current
            ? templateHref(templateId, rowView)
            : templateHref(templateId, rowView, { version: version.number });
          return (
            <li key={version.id}>
              <GuardedLink
                href={href}
                aria-current={here ? "page" : undefined}
                className={`flex flex-col gap-0.5 rounded-lg px-1.5 py-1.5 ${here ? rowActiveClass : rowIdleClass}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-neutral-900 dark:text-white">Version {version.number}</span>
                  <span className="flex gap-2 text-neutral-400">
                    {current ? <span>current</span> : null}
                    {viewing ? <span>viewing</span> : null}
                  </span>
                </span>
                <span className="text-neutral-500">
                  <FormattedDate value={version.savedAt} />
                </span>
                <span>{versionLabel(version, detail)}</span>
                <span className="text-neutral-500">{formatVersionCounts(version.counts)}</span>
              </GuardedLink>
            </li>
          );
        })}
      </ul>
      <p className="shrink-0 border-t border-black/[0.05] px-3 py-2 text-neutral-500 dark:border-white/[0.06]">
        Opening an old Version is read-only. Restoring it creates a new Version.
      </p>
    </aside>
  );
}
