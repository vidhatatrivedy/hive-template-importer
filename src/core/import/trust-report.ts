import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import {
  catalogueEntry,
  issueClasses,
  issueKinds,
  issueSeverities,
  renderIssueMessage,
  type IssueClass,
  type IssueKind,
  type IssueSeverity,
} from "@/core/import/catalogue";
import { reconcile, type Cell, type ReconcileResult, type ReconcileRow } from "@/core/import/reconcile";
import {
  countEditableTree,
  type Comment,
  type EditableTree,
  type ImportEvidence,
  type ImportIssue,
} from "@/core/import/schemas";

export type ReportStatus = "✓" | "✗";

export type ReportLocation = {
  section: string;
  item: string;
  comment: string;
};

/** A Section or Item in the report. `sourceRows` is how many distinct Source rows its Comments point at. */
export type ReconciliationItem = {
  name: string;
  split: boolean;
  sourceRows: number;
  comments: number;
  issues: number;
  status: ReportStatus;
};

export type ReconciliationSection = ReconciliationItem & {
  itemCount: number;
  items: ReconciliationItem[];
};

export type TrustIssue = {
  sourceRow: number | null;
  location: ReportLocation | null;
  message: string;
  cuts: ImportIssue["cuts"];
};

export type TrustIssueGroup = {
  kind: IssueKind;
  severity: IssueSeverity;
  class: IssueClass;
  title: string;
  count: number;
  issues: TrustIssue[];
};

export type ExternalAssetUrl = {
  url: string;
  sourceRows: number[];
};

export type ExternalAssetHost = {
  host: string;
  urls: ExternalAssetUrl[];
};

export type KeptColumn = {
  column: string;
  nonDefaultRows: number;
};

export type MissingFromExport = {
  entries: string[];
  expectedColumnMissing: number;
  youtubeWrapperEmpty: number;
};

export type TrustReportSummary = {
  filename: string;
  /** First 8 hex characters of the Import run's SHA-256. */
  sha256: string;
  byteSize: number;
  rowsRead: number;
  blankRows: number;
  commentsStored: number;
  sections: number;
  items: number;
  comments: number;
  bySeverity: Record<IssueSeverity, number>;
  byClass: Record<IssueClass, number>;
  valuesDecoded: number;
  verdict: { verified: number; total: number };
};

export type TrustReport = {
  summary: TrustReportSummary;
  sections: ReconciliationSection[];
  rows: ReconcileRow[];
  issueGroups: TrustIssueGroup[];
  externalAssets: ExternalAssetHost[];
  keptButNotUsed: KeptColumn[];
  missingFromExport: MissingFromExport;
};

const MISSING_FROM_EXPORT = [
  "empty Sections and Items",
  "Section and Item settings",
  "template attachments",
  "the template name",
  "recommendation labels",
  "default photos as files",
] as const;

/**
 * Columns kept in the Source row and not shown in the editor.
 * Order and Last Modified are never part of this list. Estimates have their own Import issues.
 * Default photo columns are one group. An own copy, so this does not call the parser.
 */
const RAW_ONLY_COLUMNS = [
  { header: 'Default Value 2 (for "range" types)', column: "Default Value 2" },
  { header: 'Default Unit Type (for "number" and "range" types)', column: "Default Unit Type" },
  { header: "Default Location", column: "Default Location" },
  { header: "Locked", column: "Locked" },
  { header: "Simple Format", column: "Simple Format" },
  { header: "Disable Photos", column: "Disable Photos" },
  { header: "Uses", column: "Uses" },
] as const;

const DEFAULT_PHOTO_HEADERS = Array.from({ length: 10 }, (_, index) => {
  const number = index + 1;
  return [`Default Photo ${number}`, `Default Photo ${number} Caption`];
}).flat();

type HtmlNode = DefaultTreeAdapterTypes.Node;

/**
 * Import Trust Report data for one Import run, from stored Version 1 plus its evidence.
 * The verdict and row checks come from reconcile.
 */
export function buildTrustReport(evidence: ImportEvidence, version1: EditableTree): TrustReport {
  const result = reconcile(evidence, version1);
  return {
    summary: summaryOf(evidence, version1, result),
    sections: sectionsOf(evidence, version1, result),
    rows: result.rows,
    issueGroups: issueGroupsOf(evidence, version1),
    externalAssets: externalAssetsOf(version1),
    keptButNotUsed: keptButNotUsed(evidence),
    missingFromExport: missingOf(evidence),
  };
}

function summaryOf(evidence: ImportEvidence, tree: EditableTree, result: ReconcileResult): TrustReportSummary {
  const counts = countEditableTree(tree);
  const bySeverity = zeroRecord(issueSeverities);
  const byClass = zeroRecord(issueClasses);
  for (const issue of evidence.issues) {
    const entry = catalogueEntry(issue.kind);
    bySeverity[entry.severity] += 1;
    byClass[entry.class] += 1;
  }
  return {
    filename: evidence.run.filename,
    sha256: evidence.run.sha256.slice(0, 8),
    byteSize: evidence.run.byteSize,
    rowsRead: evidence.run.rowsRead,
    blankRows: evidence.run.blankRows,
    commentsStored: counts.comments,
    sections: counts.sections,
    items: counts.items,
    comments: counts.comments,
    bySeverity,
    byClass,
    valuesDecoded: evidence.run.valuesDecoded,
    verdict: { verified: result.verified, total: result.total },
  };
}

function zeroRecord<Key extends string>(keys: readonly Key[]): Record<Key, number> {
  const counts = {} as Record<Key, number>;
  for (const key of keys) counts[key] = 0;
  return counts;
}

function sectionsOf(evidence: ImportEvidence, tree: EditableTree, result: ReconcileResult): ReconciliationSection[] {
  const rowsBySource = new Map<number, ReconcileRow>();
  for (const row of result.rows) {
    if (row.sourceRow !== null && !rowsBySource.has(row.sourceRow)) rowsBySource.set(row.sourceRow, row);
  }
  return tree.sections.map((section) => {
    const items = section.items.map((item) =>
      reconciliationNode(item.name, item.comments, evidence.issues, rowsBySource, "item"),
    );
    const comments = section.items.flatMap((item) => item.comments);
    const node = reconciliationNode(section.name, comments, evidence.issues, rowsBySource, "section");
    const failed = section.items.length === 0 || items.some((item) => item.status === "✗");
    return { ...node, itemCount: section.items.length, items, status: failed ? "✗" : "✓" };
  });
}

function reconciliationNode(
  name: string,
  comments: readonly Comment[],
  issues: readonly ImportIssue[],
  rowsBySource: ReadonlyMap<number, ReconcileRow>,
  level: "section" | "item",
): ReconciliationItem {
  const sourceRows = uniqueSourceRows(comments);
  const sourceSet = new Set(sourceRows);
  return {
    name,
    split: isSplitRun(sourceSet, issues, level),
    sourceRows: sourceRows.length,
    comments: comments.length,
    issues: issues.filter((issue) => issue.sourceRow !== null && sourceSet.has(issue.sourceRow)).length,
    status: nodeStatus(comments, rowsBySource),
  };
}

function uniqueSourceRows(comments: readonly Comment[]): number[] {
  const rows: number[] = [];
  for (const comment of comments) {
    if (comment.sourceRow !== null && !rows.includes(comment.sourceRow)) rows.push(comment.sourceRow);
  }
  return rows;
}

function nodeStatus(comments: readonly Comment[], rowsBySource: ReadonlyMap<number, ReconcileRow>): ReportStatus {
  if (comments.length === 0) return "✗";
  for (const comment of comments) {
    if (comment.sourceRow === null) return "✗";
    if (rowsBySource.get(comment.sourceRow)?.status !== "✓") return "✗";
  }
  return "✓";
}

function isSplitRun(sourceRows: ReadonlySet<number>, issues: readonly ImportIssue[], level: "section" | "item"): boolean {
  return issues.some(
    (issue) =>
      issue.kind === "split-run" &&
      issue.sourceRow !== null &&
      sourceRows.has(issue.sourceRow) &&
      splitLevel(issue.detail) === level,
  );
}

function splitLevel(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || !("level" in detail)) return null;
  return typeof detail.level === "string" ? detail.level : null;
}

function issueGroupsOf(evidence: ImportEvidence, tree: EditableTree): TrustIssueGroup[] {
  const locations = locationsOf(tree);
  const groups: TrustIssueGroup[] = [];
  for (const kind of issueKinds) {
    const issues = evidence.issues.filter((issue) => issue.kind === kind);
    if (issues.length === 0) continue;
    const entry = catalogueEntry(kind);
    groups.push({
      kind,
      severity: entry.severity,
      class: entry.class,
      title: entry.title,
      count: issues.length,
      issues: issues.map((issue) => ({
        sourceRow: issue.sourceRow,
        location: issue.sourceRow === null ? null : (locations.get(issue.sourceRow) ?? null),
        message: renderIssueMessage(kind, issue.detail),
        cuts: issue.cuts,
      })),
    });
  }
  return groups;
}

function locationsOf(tree: EditableTree): Map<number, ReportLocation> {
  const locations = new Map<number, ReportLocation>();
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        if (comment.sourceRow === null || locations.has(comment.sourceRow)) continue;
        locations.set(comment.sourceRow, { section: section.name, item: item.name, comment: comment.name });
      }
    }
  }
  return locations;
}

function externalAssetsOf(tree: EditableTree): ExternalAssetHost[] {
  const hosts: ExternalAssetHost[] = [];
  const byHost = new Map<string, ExternalAssetHost>();
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        for (const asset of assetsIn(comment.textHtml)) addAsset(hosts, byHost, asset, comment.sourceRow);
      }
    }
  }
  for (const host of hosts) {
    for (const url of host.urls) url.sourceRows.sort((left, right) => left - right);
  }
  return hosts;
}

function addAsset(
  hosts: ExternalAssetHost[],
  byHost: Map<string, ExternalAssetHost>,
  asset: { host: string; url: string },
  sourceRow: number | null,
): void {
  let host = byHost.get(asset.host);
  if (!host) {
    host = { host: asset.host, urls: [] };
    byHost.set(asset.host, host);
    hosts.push(host);
  }
  let url = host.urls.find((entry) => entry.url === asset.url);
  if (!url) {
    url = { url: asset.url, sourceRows: [] };
    host.urls.push(url);
  }
  if (sourceRow !== null && !url.sourceRows.includes(sourceRow)) url.sourceRows.push(sourceRow);
}

function assetsIn(html: string): { host: string; url: string }[] {
  const found: { host: string; url: string }[] = [];
  walkHtml(parseFragment(html), (element) => {
    if (element.tagName !== "img" && element.tagName !== "iframe") return;
    const src = element.attrs.find((attribute) => attribute.name === "src")?.value;
    if (!src) return;
    const host = externalHost(src);
    if (!host) return;
    found.push({ host, url: src });
  });
  return found;
}

function walkHtml(node: HtmlNode, visit: (element: DefaultTreeAdapterTypes.Element) => void): void {
  if ("tagName" in node) visit(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) walkHtml(child, visit);
  }
  if ("content" in node) walkHtml(node.content, visit);
}

function externalHost(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.host;
}

function keptButNotUsed(evidence: ImportEvidence): KeptColumn[] {
  const columns: KeptColumn[] = [];
  for (const raw of RAW_ONLY_COLUMNS) {
    const index = findHeader(evidence.run.headers, raw.header);
    if (index < 0) continue;
    columns.push({ column: raw.column, nonDefaultRows: nonDefaultRows(evidence, [index], raw.header) });
  }
  const photoIndexes = DEFAULT_PHOTO_HEADERS.map((header) => findHeader(evidence.run.headers, header)).filter(
    (index) => index >= 0,
  );
  if (photoIndexes.length > 0) {
    columns.push({ column: "Default photos", nonDefaultRows: nonDefaultRows(evidence, photoIndexes, "Default photos") });
  }
  return columns;
}

function nonDefaultRows(evidence: ImportEvidence, indexes: readonly number[], header: string): number {
  let count = 0;
  for (const row of evidence.sourceRows) {
    const content = indexes.some((index) => !isDefaultCell(header, row.cells[index] ?? null));
    if (content) count += 1;
  }
  return count;
}

/** An empty cell is the default. Uses is also default at 0, including the string `"0"`. */
function isDefaultCell(header: string, value: Cell): boolean {
  if (header === "Uses") return isBlank(value) || value === 0 || value === "0";
  return isBlank(value);
}

function isBlank(value: Cell): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function missingOf(evidence: ImportEvidence): MissingFromExport {
  return {
    entries: [...MISSING_FROM_EXPORT],
    expectedColumnMissing: evidence.issues.filter((issue) => issue.kind === "expected-column-missing").length,
    youtubeWrapperEmpty: evidence.issues.filter((issue) => issue.kind === "youtube-wrapper-empty").length,
  };
}

function findHeader(headers: readonly string[], expected: string): number {
  return headers.findIndex((header) => matchesExpectedHeader(header, expected));
}

/** Own copy of the parser's header rule, so a parser bug cannot hide a raw-only column. */
function matchesExpectedHeader(fileHeader: string, expected: string): boolean {
  const file = fileHeader.trim().toLowerCase();
  return file === expected.trim().toLowerCase() || file === withoutHint(expected);
}

function withoutHint(header: string): string {
  return header.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
}
