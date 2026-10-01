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
    const list =
      quoted.length === 2
        ? `${quoted[0]} and ${quoted[1]}`
        : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
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

const noDetail = z.object({});

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

export function renderIssueMessage(kind: IssueKind, detail: unknown): string {
  const entry = catalogue.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Unknown Import issue kind: ${kind}`);
  return messageOf(entry, detail);
}

/**
 * Catalogue entries each close over their own detail type, so a found entry's `message`
 * cannot be called with the parsed value without naming that relationship here.
 */
function messageOf(entry: (typeof catalogue)[number], detail: unknown): string {
  const parsed = entry.detail.parse(detail);
  return (entry.message as (value: typeof parsed) => string)(parsed);
}
