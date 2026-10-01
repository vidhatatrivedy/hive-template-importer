import { catalogueEntry } from "@/core/import/catalogue";
import type { ReconciliationNode, ReconciliationSection, TrustReport } from "@/core/import/trust-report";

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

export type ExternalAssetsView = {
  /** Set when the report lists no hosts. The note is absent in that case. */
  empty: typeof EXTERNAL_ASSETS_EMPTY | null;
  note: typeof EXTERNAL_ASSETS_NOTE | null;
  hosts: { host: string; urls: ExternalAssetUrlView[] }[];
};

export type KeptColumnView = {
  column: string;
  rowsHoldingContent: number;
};

export type MissingCountView = {
  title: string;
  count: number;
};

/** What the Trust Report shows below the Summary, in section order, from the report as it comes. */
export type TrustSectionsView = {
  reconciliation: ReconciliationSectionView[];
  externalAssets: ExternalAssetsView;
  keptButNotUsed: { note: typeof KEPT_NOTE; columns: KeptColumnView[] };
  missingFromExport: { entries: string[]; counts: [MissingCountView, MissingCountView] };
};

export function trustSectionsView(report: TrustReport): TrustSectionsView {
  return {
    reconciliation: report.sections.map(sectionView),
    externalAssets: externalAssetsView(report),
    keptButNotUsed: {
      note: KEPT_NOTE,
      columns: report.keptButNotUsed.map((column) => ({
        column: column.column,
        rowsHoldingContent: column.nonDefaultRows,
      })),
    },
    missingFromExport: {
      entries: [...report.missingFromExport.entries],
      counts: [
        {
          title: catalogueEntry("expected-column-missing").title,
          count: report.missingFromExport.expectedColumnMissing,
        },
        {
          title: catalogueEntry("youtube-wrapper-empty").title,
          count: report.missingFromExport.youtubeWrapperEmpty,
        },
      ],
    },
  };
}

function sectionView(section: ReconciliationSection): ReconciliationSectionView {
  return {
    row: rowView(section, section.itemCount),
    items: section.items.map((item) => rowView(item, null)),
  };
}

/** `itemCount` is null on an Item, which has no Items of its own. Status is the report's glyph. */
function rowView(node: ReconciliationNode, itemCount: number | null): ReconciliationRowView {
  const parts = [
    countPhrase(node.sourceRows, "source row", "source rows"),
    countPhrase(node.comments, "stored Comment", "stored Comments"),
  ];
  if (itemCount !== null) parts.push(countPhrase(itemCount, "Item", "Items"));
  parts.push(countPhrase(node.issues, "issue", "issues"));
  return {
    name: node.name,
    mark: node.split ? SPLIT_RUN_MARK : null,
    counts: parts.join(" · "),
    status: node.status,
  };
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function externalAssetsView(report: TrustReport): ExternalAssetsView {
  if (report.externalAssets.length === 0) {
    return { empty: EXTERNAL_ASSETS_EMPTY, note: null, hosts: [] };
  }
  return {
    empty: null,
    note: EXTERNAL_ASSETS_NOTE,
    hosts: report.externalAssets.map((host) => ({
      host: host.host,
      urls: host.urls.map((asset) => ({ url: asset.url, sourceRows: [...asset.sourceRows] })),
    })),
  };
}
