import type { IssueClass, IssueKind, IssueSeverity } from "@/core/import/catalogue";
import type { TrustIssueGroup } from "@/core/import/trust-report";

/** One Import issue as the Trust Report list renders it. No cuts. */
export type ImportIssueView = {
  /** "Section › Item › Comment" for a row issue. Null for a file-level issue. */
  location: string | null;
  sourceRow: number | null;
  message: string;
};

/** One catalogue group. `open` is the starting state: warnings open, notices closed. */
export type ImportIssueGroupView = {
  kind: IssueKind;
  severity: IssueSeverity;
  class: IssueClass;
  title: string;
  count: number;
  open: boolean;
  issues: ImportIssueView[];
};

/** A list issue plus its Source row link. A file-level issue has no row, so `href` is null. */
export type LinkedImportIssue = ImportIssueView & { href: string | null };

export type LinkedImportIssueGroup = Omit<ImportIssueGroupView, "issues"> & {
  issues: LinkedImportIssue[];
};

export type IssueFilterSelection = {
  severities: readonly IssueSeverity[];
  classes: readonly IssueClass[];
};

const LOCATION_SEPARATOR = " › ";

/**
 * The Import issues list for the browser: catalogue order, location, Source row and message.
 * Cuts and row checks are not copied.
 */
export function importIssuesView(groups: readonly TrustIssueGroup[]): ImportIssueGroupView[] {
  return groups.map((group) => ({
    kind: group.kind,
    severity: group.severity,
    class: group.class,
    title: group.title,
    count: group.count,
    open: group.severity === "warning",
    issues: group.issues.map((issue) => ({
      location: issue.location
        ? [issue.location.section, issue.location.item, issue.location.comment].join(LOCATION_SEPARATOR)
        : null,
      sourceRow: issue.sourceRow,
      message: issue.message,
    })),
  }));
}

/**
 * Severity and class combine with AND. Values within one axis combine with OR.
 * A group with nothing left to show is dropped. Group counts stay the full count.
 */
export function filterIssueGroups<Group extends ImportIssueGroupView>(
  groups: readonly Group[],
  selection: IssueFilterSelection,
): Group[] {
  const severities = new Set(selection.severities);
  const classes = new Set(selection.classes);
  return groups.filter(
    (group) => severities.has(group.severity) && classes.has(group.class) && group.issues.length > 0,
  );
}

/** Adds the Source row link. A file-level issue has no row, so it gets no link. */
export function attachSourceRowLinks(
  groups: readonly ImportIssueGroupView[],
  hrefFor: (row: number) => string,
): LinkedImportIssueGroup[] {
  return groups.map((group) => ({
    ...group,
    issues: group.issues.map((issue) => ({
      ...issue,
      href: issue.sourceRow === null ? null : hrefFor(issue.sourceRow),
    })),
  }));
}
