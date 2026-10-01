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

const whitespaceTrimmed = {
  kind: "whitespace-trimmed",
  level: "row",
  severity: "notice",
  class: "Changed",
  title: "Whitespace trimmed",
  detail: z.object({ field: z.string().min(1) }),
  message: (detail: { field: string }) => `Leading and trailing spaces were removed from ${detail.field}.`,
} satisfies CatalogueEntry<{ field: string }>;

export const catalogue = [whitespaceTrimmed] as const;

export const issueKinds = [whitespaceTrimmed.kind] as const;
export type IssueKind = (typeof issueKinds)[number];

export function renderIssueMessage(kind: IssueKind, detail: unknown): string {
  const entry = catalogue.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Unknown Import issue kind: ${kind}`);
  return entry.message(entry.detail.parse(detail) as never);
}
