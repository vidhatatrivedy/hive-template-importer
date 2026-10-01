/** What the sidebar shows and decides, kept pure so it can be tested without a browser. */

import { formatDate } from "@/app/ui/format-date";
import type { TemplateSummary } from "@/db/schemas";

/** What the pathname says is open. `viewingVersion` is set on the read-only Version view. */
export type OpenTemplate = { templateId: string; viewingVersion: number | null } | null;

/** Reads `/t/<id>` and `/t/<id>/v/<n>`. Anything else is not a Template page. */
export function parseOpenTemplate(pathname: string): OpenTemplate {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [root, id, sub, version] = segments;
  if (root !== "t" || id === undefined) return null;
  const templateId = decodeURIComponent(id);
  if (segments.length === 2) return { templateId, viewingVersion: null };
  if (segments.length === 4 && sub === "v") return { templateId, viewingVersion: parseVersion(version) };
  return null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago `iso` was, in the sidebar's words. A future time (clock skew) is "just now". */
export function relativeTime(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 2 * DAY) return "yesterday";
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} days ago`;
  return formatDate(iso, true);
}

/** "Imported · 2h ago". A Copy names its source by the name it had when copied. */
export function sidebarLine(summary: TemplateSummary, now: Date): string {
  return `${creationLabel(summary)} · ${relativeTime(summary.latest.savedAt, now)}`;
}

function creationLabel(summary: TemplateSummary): string {
  switch (summary.creation) {
    case "import":
      return "Imported";
    case "blank":
      return "Blank";
    case "copy":
      return summary.copiedFromName === null ? "Copy" : `Copy of ${summary.copiedFromName}`;
  }
}

function parseVersion(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  return Number(value);
}
