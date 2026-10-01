import { z } from "zod";

/** Severities an Import issue can have. `warning` changes what the reader understands; `notice` does not. */
export const issueSeverities = ["warning", "notice"] as const;

/** Classes an Import issue is grouped under in the Trust Report. */
export const issueClasses = ["Changed", "Unsupported", "Missing from export", "Check"] as const;

export type IssueSeverity = (typeof issueSeverities)[number];
export type IssueClass = (typeof issueClasses)[number];
export type IssueLevel = "file" | "row";

type CatalogueEntry<Detail> = {
  kind: string;
  level: IssueLevel;
  severity: IssueSeverity;
  class: IssueClass;
  title: string;
  detail: z.ZodType<Detail>;
  message: (detail: Detail) => string;
};

/** Keeps `kind` as a string literal. `satisfies CatalogueEntry` widens it to `string`. */
function defineIssue<const K extends string, Detail>(entry: CatalogueEntry<Detail> & { kind: K }) {
  return entry;
}

const expectedColumnMissing = defineIssue({
  kind: "expected-column-missing",
  level: "file",
  severity: "warning",
  class: "Missing from export",
  title: "Expected column missing",
  detail: z.object({ column: z.string().min(1) }),
  message: (detail: { column: string }) => `${detail.column} wasn't in this export, so it was left empty.`,
});

const unknownColumn = defineIssue({
  kind: "unknown-column",
  level: "file",
  severity: "notice",
  class: "Unsupported",
  title: "Unknown column",
  detail: z.object({ header: z.string(), column: z.number().int().positive() }),
  message: (detail: { header: string; column: number }) =>
    detail.header.trim() === ""
      ? `Column ${detail.column} has no header. Its cells were kept in the Source row.`
      : `Column ${detail.column} ("${detail.header}") wasn't used. Its cells were kept in the Source row.`,
});

const extraSheet = defineIssue({
  kind: "extra-sheet",
  level: "file",
  severity: "warning",
  class: "Unsupported",
  title: "Extra sheet",
  detail: z.object({ sheets: z.array(z.string().min(1)).min(1) }),
  message: (detail: { sheets: string[] }) => {
    const quoted = detail.sheets.map((sheet) => `"${sheet}"`);
    if (quoted.length === 1) return `The sheet ${quoted[0]} wasn't read. Only the first sheet was imported.`;
    const list = `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
    return `The sheets ${list} weren't read. Only the first sheet was imported.`;
  },
});

const whitespaceTrimmed = defineIssue({
  kind: "whitespace-trimmed",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Whitespace trimmed",
  detail: z.object({ field: z.string().min(1) }),
  message: (detail: { field: string }) => `Leading and trailing spaces were removed from ${detail.field}.`,
});

const noDetail = z.object({});
const categoryValue = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

/** Spectora headers carry a parenthetical hint. Issue text names the column without it. */
function columnTitle(field: string): string {
  return field.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function untitledName(field: string): string {
  if (field === "Section Name") return "Untitled Section";
  if (field === "Item Name") return "Untitled Item";
  if (field === "Comment Name") return "Untitled Comment";
  return "Untitled";
}

function commentTypeLabel(commentType: "info" | "limit" | "defect"): string {
  if (commentType === "info") return "Informational";
  if (commentType === "limit") return "Limitation";
  return "Deficiency";
}

function formatSpan(firstRow: number, lastRow: number): string {
  return firstRow === lastRow ? `row ${firstRow}` : `rows ${firstRow}-${lastRow}`;
}

function formatRowList(rows: readonly number[]): string {
  return `rows ${joinClauses(rows.map(String))}`;
}

function joinClauses(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const vocabularyNormalised = defineIssue({
  kind: "vocabulary-normalised",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Vocabulary normalised",
  detail: z.object({ field: z.string().min(1) }),
  message: (detail: { field: string }) => `${columnTitle(detail.field)} was re-cased or trimmed.`,
});

const booleanDefaultNormalised = defineIssue({
  kind: "boolean-default-normalised",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Boolean default normalised",
  detail: z.object({ value: z.boolean() }),
  message: (detail: { value: boolean }) =>
    detail.value ? "Default Value was stored as yes." : "Default Value was stored as no.",
});

const booleanDefaultInvalid = defineIssue({
  kind: "boolean-default-invalid",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Boolean default invalid",
  detail: noDetail,
  message: () => "Default Value wasn't a yes/no value, so none was stored.",
});

const commentTypeFallback = defineIssue({
  kind: "comment-type-fallback",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Comment type not recognised",
  detail: noDetail,
  message: () => "Comment Type was blank or not a known value, so it was stored as Informational.",
});

const answerTypeFallback = defineIssue({
  kind: "answer-type-fallback",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Answer type not recognised",
  detail: noDetail,
  message: () => "Answer Type was blank or not a known value, so it was stored as yes/no.",
});

const categoryMissing = defineIssue({
  kind: "category-missing",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Category missing",
  detail: noDetail,
  message: () => "This defect has no valid Category, so none was stored.",
});

const categoryOrphan = defineIssue({
  kind: "category-orphan",
  level: "row",
  severity: "notice",
  class: "Check",
  title: "Category kept",
  detail: z.object({ category: categoryValue }),
  message: (detail: { category: -1 | 0 | 1 }) =>
    `Category ${detail.category} was kept on an Informational or Limitation Comment.`,
});

const blankName = defineIssue({
  kind: "blank-name",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Blank name",
  detail: z.object({ field: z.string().min(1) }),
  message: (detail: { field: string }) => {
    const title = columnTitle(detail.field);
    return `${title} was blank, so it was stored as ${untitledName(title)}.`;
  },
});

const checkboxDefaultNotInOptions = defineIssue({
  kind: "checkbox-default-not-in-options",
  level: "row",
  severity: "notice",
  class: "Check",
  title: "Checkbox default not in options",
  detail: z.object({ value: z.string().min(1) }),
  message: (detail: { value: string }) => `Default Value "${detail.value}" isn't one of the choice options.`,
});

const emptyOptionDropped = defineIssue({
  kind: "empty-option-dropped",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Empty option dropped",
  detail: z.object({ field: z.string().min(1) }),
  message: (detail: { field: string }) => `An empty entry was dropped from ${columnTitle(detail.field)}.`,
});

const optionsOrphan = defineIssue({
  kind: "options-orphan",
  level: "row",
  severity: "notice",
  class: "Check",
  title: "Choice options kept",
  detail: noDetail,
  message: () => "Choice options were kept on a Comment that isn't a checkbox.",
});

const rowRange = z.object({
  firstRow: z.number().int().positive(),
  lastRow: z.number().int().positive(),
});

const splitRun = defineIssue({
  kind: "split-run",
  level: "row",
  severity: "warning",
  class: "Check",
  title: "Split run",
  detail: z.object({
    level: z.enum(["section", "item"]),
    name: z.string().min(1),
    firstRow: z.number().int().positive(),
    lastRow: z.number().int().positive(),
    earlierRuns: z.array(rowRange).min(1),
  }),
  message: (detail: {
    level: "section" | "item";
    name: string;
    firstRow: number;
    lastRow: number;
    earlierRuns: { firstRow: number; lastRow: number }[];
  }) => {
    const level = detail.level === "section" ? "Section" : "Item";
    const earlier = detail.earlierRuns.map((run) => formatSpan(run.firstRow, run.lastRow));
    const earlierText =
      earlier.length === 1 ? `An earlier run is ${earlier[0]}.` : `Earlier runs are ${joinClauses(earlier)}.`;
    return `"${detail.name}" appears again as its own ${level} (${formatSpan(detail.firstRow, detail.lastRow)}). ${earlierText}`;
  },
});

const duplicateComment = defineIssue({
  kind: "duplicate-comment",
  level: "row",
  severity: "notice",
  class: "Check",
  title: "Duplicate comment",
  detail: z.object({
    name: z.string().min(1),
    commentType: z.enum(["info", "limit", "defect"]),
    rows: z.array(z.number().int().positive()).min(2),
  }),
  message: (detail: { name: string; commentType: "info" | "limit" | "defect"; rows: number[] }) =>
    `"${detail.name}" (${commentTypeLabel(detail.commentType)}) is repeated on ${formatRowList(detail.rows)}. Each one was kept.`,
});

const editorLeftovers = defineIssue({
  kind: "editor-leftovers",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Editor leftovers removed",
  detail: z.object({ count: z.number().int().positive() }),
  message: (detail: { count: number }) =>
    detail.count === 1
      ? "1 editor leftover was removed from this Comment."
      : `${detail.count} editor leftovers were removed from this Comment.`,
});

const attributeRemoved = defineIssue({
  kind: "attribute-removed",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Attribute removed",
  detail: z.object({ tag: z.string().min(1), attribute: z.string().min(1) }),
  message: (detail: { tag: string; attribute: string }) => `The ${detail.attribute} attribute was removed from <${detail.tag}>.`,
});

const tagUnwrapped = defineIssue({
  kind: "tag-unwrapped",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Tag unwrapped",
  detail: z.object({ tag: z.string().min(1) }),
  message: (detail: { tag: string }) => `A <${detail.tag}> tag was removed and its text was kept.`,
});

const styleUnparseable = defineIssue({
  kind: "style-unparseable",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Unparseable style removed",
  detail: z.object({ tag: z.string().min(1) }),
  message: (detail: { tag: string }) => `A style attribute on <${detail.tag}> could not be parsed and was removed.`,
});

const tagRemoved = defineIssue({
  kind: "tag-removed",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Tag removed",
  detail: z.object({ tag: z.string().min(1) }),
  message: (detail: { tag: string }) => `A <${detail.tag}> tag was removed along with its content.`,
});

const linkSchemeRemoved = defineIssue({
  kind: "link-scheme-removed",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Link scheme removed",
  detail: z.object({ tag: z.string().min(1) }),
  message: (detail: { tag: string }) => `An address on <${detail.tag}> was removed because its scheme is not allowed.`,
});

const iframeToLink = defineIssue({
  kind: "iframe-to-link",
  level: "row",
  severity: "warning",
  class: "Unsupported",
  title: "Non-YouTube iframe turned into a link",
  detail: noDetail,
  message: () => "An embedded frame from another site was turned into a link.",
});

const markupRebuilt = defineIssue({
  kind: "markup-rebuilt",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Markup rebuilt",
  detail: noDetail,
  message: () => "This Comment's markup was rebuilt. Check it closely.",
});

const youtubeWrapperEmpty = defineIssue({
  kind: "youtube-wrapper-empty",
  level: "row",
  severity: "warning",
  class: "Missing from export",
  title: "Empty YouTube wrapper",
  detail: noDetail,
  message: () => "An empty YouTube wrapper was removed. The video was not in the export.",
});

const unsafeStyleRemoved = defineIssue({
  kind: "unsafe-style-removed",
  level: "row",
  severity: "warning",
  class: "Changed",
  title: "Unsafe style removed",
  detail: z.object({ tag: z.string().min(1), property: z.string().min(1) }),
  message: (detail: { tag: string; property: string }) =>
    `A ${detail.property} style on <${detail.tag}> was removed because its value could load remote content or run code.`,
});

export const catalogue = [
  expectedColumnMissing,
  unknownColumn,
  extraSheet,
  whitespaceTrimmed,
  vocabularyNormalised,
  booleanDefaultNormalised,
  booleanDefaultInvalid,
  commentTypeFallback,
  answerTypeFallback,
  categoryMissing,
  categoryOrphan,
  blankName,
  checkboxDefaultNotInOptions,
  emptyOptionDropped,
  optionsOrphan,
  splitRun,
  duplicateComment,
  editorLeftovers,
  attributeRemoved,
  tagUnwrapped,
  styleUnparseable,
  tagRemoved,
  linkSchemeRemoved,
  iframeToLink,
  markupRebuilt,
  youtubeWrapperEmpty,
  unsafeStyleRemoved,
] as const;

export const issueKinds = [
  expectedColumnMissing.kind,
  unknownColumn.kind,
  extraSheet.kind,
  whitespaceTrimmed.kind,
  vocabularyNormalised.kind,
  booleanDefaultNormalised.kind,
  booleanDefaultInvalid.kind,
  commentTypeFallback.kind,
  answerTypeFallback.kind,
  categoryMissing.kind,
  categoryOrphan.kind,
  blankName.kind,
  checkboxDefaultNotInOptions.kind,
  emptyOptionDropped.kind,
  optionsOrphan.kind,
  splitRun.kind,
  duplicateComment.kind,
  editorLeftovers.kind,
  attributeRemoved.kind,
  tagUnwrapped.kind,
  styleUnparseable.kind,
  tagRemoved.kind,
  linkSchemeRemoved.kind,
  iframeToLink.kind,
  markupRebuilt.kind,
  youtubeWrapperEmpty.kind,
  unsafeStyleRemoved.kind,
] as const;
export type IssueKind = (typeof issueKinds)[number];

export function catalogueEntry(kind: string): (typeof catalogue)[number] {
  const entry = catalogue.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Unknown Import issue kind: ${kind}`);
  return entry;
}

export function renderIssueMessage(kind: IssueKind, detail: unknown): string {
  return messageOf(catalogueEntry(kind), detail);
}

/**
 * Catalogue entries each close over their own detail type, so a found entry's `message`
 * cannot be called with the parsed value without naming that relationship here.
 */
function messageOf(entry: (typeof catalogue)[number], detail: unknown): string {
  const parsed = entry.detail.parse(detail);
  return (entry.message as (value: typeof parsed) => string)(parsed);
}
