import { catalogueEntry } from "@/core/import/catalogue";
import type {
  ExternalAssetHost,
  ReconciliationNode,
  ReconciliationSection,
  TrustReport,
} from "@/core/import/trust-report";

/** Shown beside a Section or Item name when that name continues an earlier run. */
export const SPLIT_RUN_MARK = "split run";

export const EXTERNAL_ASSETS_EMPTY = "No External assets.";

export const EXTERNAL_ASSETS_NOTE =
  "These load from another host and may stop loading once you leave Spectora.";

export const KEPT_NOTE = "Kept in each Source row, not shown in the editor.";

export type ReconciliationRowView = {
  name: string;
  /** "split run" on a later run of the same name, otherwise nothing to mark. */
  mark: typeof SPLIT_RUN_MARK | null;
  /** Source rows, stored Comments, Items (a Section only) and issues, in that order. */
  counts: string;
  status: "✓" | "✗";
};

export type ReconciliationSectionView = {
  row: ReconciliationRowView;
  items: ReconciliationRowView[];
};

export type ExternalAssetUrlView = {
  url: string;
  sourceRows: number[];
};

export type ExternalAssetHostView = {
  host: string;
  urls: ExternalAssetUrlView[];
};

export type ExternalAssetsView = {
  /** Set when the report lists no hosts. The note is absent in that case. */
  empty: typeof EXTERNAL_ASSETS_EMPTY | null;
  note: typeof EXTERNAL_ASSETS_NOTE | null;
  hosts: ExternalAssetHostView[];
};

export type KeptColumnView = {
  column: string;
  rowsHoldingContent: number;
};

export type KeptButNotUsedView = {
  note: typeof KEPT_NOTE;
  columns: KeptColumnView[];
};

export type MissingCountView = {
  title: string;
  count: number;
};

export type MissingFromExportView = {
  entries: string[];
  counts: [MissingCountView, MissingCountView];
};

/** What the Trust Report shows below the Summary, in section order, from the report as it comes. */
export type TrustSectionsView = {
  reconciliation: ReconciliationSectionView[];
  externalAssets: ExternalAssetsView;
  keptButNotUsed: KeptButNotUsedView;
  missingFromExport: MissingFromExportView;
};

export function trustSectionsView(report: TrustReport): TrustSectionsView {
  return {
    reconciliation: report.sections.map(sectionView),
    externalAssets: externalAssetsView(report),
    keptButNotUsed: keptButNotUsedView(report),
    missingFromExport: missingFromExportView(report),
  };
}

export function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sectionView(section: ReconciliationSection): ReconciliationSectionView {
  return {
    row: rowView(section, section.itemCount),
    items: section.items.map((item) => rowView(item)),
  };
}

/** Pass a Section's Item count. Omit it for an Item, which has no Items of its own. */
function rowView(node: ReconciliationNode, itemCount?: number): ReconciliationRowView {
  const counts = [
    countPhrase(node.sourceRows, "source row", "source rows"),
    countPhrase(node.comments, "stored Comment", "stored Comments"),
  ];
  if (itemCount !== undefined) counts.push(countPhrase(itemCount, "Item", "Items"));
  counts.push(countPhrase(node.issues, "issue", "issues"));
  return {
    name: node.name,
    mark: node.split ? SPLIT_RUN_MARK : null,
    counts: counts.join(" · "),
    status: node.status,
  };
}

function externalAssetsView(report: TrustReport): ExternalAssetsView {
  if (report.externalAssets.length === 0) {
    return { empty: EXTERNAL_ASSETS_EMPTY, note: null, hosts: [] };
  }
  return {
    empty: null,
    note: EXTERNAL_ASSETS_NOTE,
    hosts: report.externalAssets.map(hostView),
  };
}

function hostView(assetHost: ExternalAssetHost): ExternalAssetHostView {
  return {
    host: assetHost.host,
    urls: assetHost.urls.map((asset) => ({ url: asset.url, sourceRows: [...asset.sourceRows] })),
  };
}

function keptButNotUsedView(report: TrustReport): KeptButNotUsedView {
  return {
    note: KEPT_NOTE,
    columns: report.keptButNotUsed.map((column) => ({
      column: column.column,
      rowsHoldingContent: column.nonDefaultRows,
    })),
  };
}

function missingFromExportView(report: TrustReport): MissingFromExportView {
  const missing = report.missingFromExport;
  return {
    entries: [...missing.entries],
    counts: [
      { title: catalogueEntry("expected-column-missing").title, count: missing.expectedColumnMissing },
      { title: catalogueEntry("youtube-wrapper-empty").title, count: missing.youtubeWrapperEmpty },
    ],
  };
}
