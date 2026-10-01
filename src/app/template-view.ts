/** The Template page's search params. The only parser and builder of these URLs. */

export type TemplatePane = "trust" | "versions";

export type TemplateView = {
  panes: Set<TemplatePane>;
  row: number | null;
};

export type TemplateSearchParams = {
  pane?: string | string[];
  row?: string | string[];
};

const PANE_ORDER: readonly TemplatePane[] = ["trust", "versions"];

function isPane(value: string): value is TemplatePane {
  return PANE_ORDER.some((pane) => pane === value);
}

export function parseTemplateView(searchParams: TemplateSearchParams): TemplateView {
  const panes = new Set<TemplatePane>();
  for (const value of list(searchParams.pane)) {
    for (const token of value.split(",")) {
      const pane = token.trim();
      if (isPane(pane)) panes.add(pane);
    }
  }
  return { panes, row: parseRow(list(searchParams.row)[0]) };
}

export function templateHref(templateId: string, view: TemplateView): string {
  const params: string[] = [];
  const panes = PANE_ORDER.filter((pane) => view.panes.has(pane));
  if (panes.length > 0) params.push(`pane=${panes.join(",")}`);
  if (view.row !== null) params.push(`row=${view.row}`);
  const path = `/t/${encodeURIComponent(templateId)}`;
  return params.length > 0 ? `${path}?${params.join("&")}` : path;
}

/** Opens or closes the Trust Report, keeping Versions. Closing drops `row`, which only the report reads. */
export function withTrustPane(view: TemplateView, open: boolean): TemplateView {
  const panes = new Set(view.panes);
  if (open) {
    panes.add("trust");
    return { panes, row: view.row };
  }
  panes.delete("trust");
  return { panes, row: null };
}

function list(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A sheet row number. Row 1 is the header, so it is not a Source row; the Source row
 * view says so. Zero and anything that isn't a whole number are ignored.
 */
function parseRow(value: string | undefined): number | null {
  if (value === undefined || !/^[0-9]+$/.test(value)) return null;
  const row = Number(value);
  if (!Number.isSafeInteger(row) || row < 1) return null;
  return row;
}
