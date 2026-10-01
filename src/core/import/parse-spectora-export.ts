import { decodeHTML } from "entities";
import readXlsxFile from "read-excel-file/node";
import { sanitiseCommentHtml, type Cut } from "@/core/sanitise";
import type { Comment, ImportDraft, Item, Section } from "@/core/import/schemas";

export type ParseResult = { ok: true; draft: ImportDraft };

const COLUMNS = {
  sectionName: "Section Name",
  itemName: "Item Name",
  commentName: "Comment Name",
  commentText: "Comment Text",
  commentType: "Comment Type (info, limit, defect)",
  category: "Category (-1: Low, 0: Med, 1: High)",
  choiceOptions: "Multiple Choice Options (comma-separated)",
  unitOptions: "Unit Type Options (numeric answers only, comma-separated)",
  recommendation: "Recommendation (from list)",
  answerType: "Answer Type (boolean, checkbox, date, number, range, text)",
  defaultValue: "Default Value",
} as const;

/** Normalised plain-text columns. Comment Text is owned by the sanitiser and is not decoded. */
const DECODED_COLUMNS = [
  "sectionName",
  "itemName",
  "commentName",
  "commentType",
  "category",
  "choiceOptions",
  "unitOptions",
  "recommendation",
  "answerType",
  "defaultValue",
] as const;

const COMMENT_TYPES = ["info", "limit", "defect"] as const;
const ANSWER_TYPES = ["boolean", "checkbox", "number", "range", "text", "date"] as const;

type Cell = string | number | boolean | null;
type AnswerType = (typeof ANSWER_TYPES)[number];
type Category = -1 | 0 | 1;
type ColumnIndexes = Record<keyof typeof COLUMNS, number>;

/**
 * Turns a Spectora HTML Text export into an Import draft.
 * Header matching in this tracer is a trimmed, lowercased equality with Spectora's verbatim header.
 */
export async function parseSpectoraExport(bytes: Uint8Array, filename: string): Promise<ParseResult> {
  const sheets = await readXlsxFile(Buffer.from(bytes), { trim: false });
  const sheet = sheets[0];
  if (!sheet || sheet.data.length === 0) throw new Error("Workbook has no worksheet");

  const headers = sheet.data[0].map(headerText);
  const indexes = columnIndexes(headers);
  const sourceRows: ImportDraft["sourceRows"] = [];
  const issues: ImportDraft["issues"] = [];
  const sections: Section[] = [];
  let currentSection: Section | undefined;
  let currentItem: Item | undefined;
  let blankRows = 0;
  let valuesDecoded = 0;

  for (let index = 1; index < sheet.data.length; index++) {
    const cells = align(sheet.data[index], headers.length).map(storedCell);
    if (cells.every(isBlankCell)) {
      blankRows += 1;
      continue;
    }

    const rowNumber = index + 1;
    sourceRows.push({ rowNumber, cells });
    for (const column of DECODED_COLUMNS) {
      if (decodeCell(cells[indexes[column]]).decoded) valuesDecoded += 1;
    }

    const sectionName = trimmedName(cells[indexes.sectionName], COLUMNS.sectionName, rowNumber, issues);
    const itemName = trimmedName(cells[indexes.itemName], COLUMNS.itemName, rowNumber, issues);
    const commentName = trimmedName(cells[indexes.commentName], COLUMNS.commentName, rowNumber, issues);
    const text = sanitiseCommentHtml(commentText(cells[indexes.commentText]));
    issues.push(...issuesFromCuts(text.cuts, rowNumber));
    const comment = buildComment(cells, indexes, rowNumber, commentName, text.html);

    if (!currentSection || currentSection.name !== sectionName) {
      currentSection = { name: sectionName, items: [] };
      sections.push(currentSection);
      currentItem = undefined;
    }
    if (!currentItem || currentItem.name !== itemName) {
      currentItem = { name: itemName, comments: [] };
      currentSection.items.push(currentItem);
    }
    currentItem.comments.push(comment);
  }

  const draft: ImportDraft = {
    run: {
      filename,
      sha256: await sha256Hex(bytes),
      byteSize: bytes.byteLength,
      sheetName: sheet.sheet,
      headers,
      rowsRead: sheet.data.length - 1,
      blankRows,
      valuesDecoded,
    },
    sourceRows,
    issues,
    suggestedName: suggestedName(filename),
    tree: { sections },
  };
  return { ok: true, draft };
}

function columnIndexes(headers: string[]): ColumnIndexes {
  const indexes = {} as ColumnIndexes;
  for (const [key, header] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    indexes[key] = headerIndex(headers, header);
  }
  return indexes;
}

function headerIndex(headers: readonly string[], header: string): number {
  const want = header.trim().toLowerCase();
  const index = headers.findIndex((cell) => cell.trim().toLowerCase() === want);
  if (index < 0) throw new Error(`Missing column: ${header}`);
  return index;
}

function buildComment(cells: Cell[], indexes: ColumnIndexes, rowNumber: number, name: string, textHtml: string): Comment {
  const commentType = matchAllowedValue(cells[indexes.commentType], COMMENT_TYPES, "info");
  const answerType = matchAllowedValue(cells[indexes.answerType], ANSWER_TYPES, "boolean");
  const defaults = defaultsOf(answerType, cells[indexes.defaultValue]);
  return {
    sourceRow: rowNumber,
    name,
    textHtml,
    commentType,
    category: categoryOf(cells[indexes.category]),
    recommendation: recommendationOf(cells[indexes.recommendation]),
    answerType,
    defaultBoolean: defaults.defaultBoolean,
    defaultText: defaults.defaultText,
    choiceOptions: optionsOf(cells[indexes.choiceOptions]),
    unitOptions: optionsOf(cells[indexes.unitOptions]),
  };
}

function trimmedName(value: Cell, field: string, rowNumber: number, issues: ImportDraft["issues"]): string {
  const decoded = decodeCell(value);
  const name = decoded.text.trim();
  if (name !== decoded.text) {
    issues.push({ kind: "whitespace-trimmed", sourceRow: rowNumber, detail: { field }, cuts: [] });
  }
  return name;
}

function commentText(value: Cell): string {
  return typeof value === "string" ? value : "";
}

function matchAllowedValue<T extends string>(value: Cell, allowed: readonly T[], fallback: T): T {
  const text = decodeCell(value).text.trim().toLowerCase();
  const match = allowed.find((entry) => entry === text);
  return match ?? fallback;
}

function categoryOf(value: Cell): Category | null {
  const numeric = categoryNumber(value);
  if (numeric === -1 || numeric === 0 || numeric === 1) return numeric;
  return null;
}

function categoryNumber(value: Cell): number | null {
  if (typeof value === "number") return value;
  const text = decodeCell(value).text.trim();
  if (text === "") return null;
  return Number(text);
}

function recommendationOf(value: Cell): string | null {
  const text = decodeCell(value).text.trim();
  return text === "" ? null : text;
}

function defaultsOf(
  answerType: AnswerType,
  value: Cell,
): { defaultBoolean: boolean | null; defaultText: string | null } {
  if (answerType === "boolean") {
    if (value === true || value === "true") return { defaultBoolean: true, defaultText: null };
    if (value === false || value === "false") return { defaultBoolean: false, defaultText: null };
    return { defaultBoolean: null, defaultText: null };
  }
  const text = decodeCell(value).text.trim();
  return { defaultBoolean: null, defaultText: text === "" ? null : text };
}

/** Split, then decode each entry once. Empty entries are dropped; duplicates stay. */
function optionsOf(value: Cell): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .split(",")
    .map((entry) => decodeHTML(entry).trim())
    .filter((entry) => entry !== "");
}

function decodeCell(value: Cell): { text: string; decoded: boolean } {
  if (typeof value !== "string") return { text: value === null ? "" : String(value), decoded: false };
  const text = decodeHTML(value);
  return { text, decoded: text !== value };
}

function suggestedName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const withoutDate = withoutExtension.replace(/ *-[ ]*\d{4}-\d{2}-\d{2}$/, "").trim();
  if (withoutDate !== "") return withoutDate;
  const fallback = withoutExtension.trim();
  if (fallback !== "") return fallback;
  return "Untitled Template";
}

function headerText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function align(row: readonly unknown[] | undefined, width: number): unknown[] {
  const cells = (row ?? []).slice(0, width);
  while (cells.length < width) cells.push(null);
  return cells;
}

/** A Date becomes an ISO 8601 string. Any other non-cell value is stringified. */
function storedCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function isBlankCell(value: Cell): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * `url(`, `expression(` or `@import` in the source span. The sanitiser also sets
 * `context.unsafeValue` when those tokens only appear after decoding (entities, escapes, comments).
 */
const UNSAFE_STYLE = /url\(|expression\(|@import/i;

function isUnsafeStyle(cut: Cut): boolean {
  return cut.kind === "css-property-removed" && (cut.context.unsafeValue === true || UNSAFE_STYLE.test(cut.removedText));
}

/** Editor leftovers and routine CSS removals share one notice per Comment. */
function isBundled(cut: Cut): boolean {
  return cut.kind === "editor-leftover" || (cut.kind === "css-property-removed" && !isUnsafeStyle(cut));
}

function issuesFromCuts(cuts: readonly Cut[], sourceRow: number): ImportDraft["issues"] {
  const issues: ImportDraft["issues"] = [];
  const bundled = cuts.filter(isBundled);
  if (bundled.length > 0) {
    issues.push({
      kind: "editor-leftovers",
      sourceRow,
      detail: { count: bundled.length },
      cuts: bundled.map(evidenceCut),
    });
  }
  for (const cut of cuts) {
    if (isBundled(cut)) continue;
    issues.push(issueForCut(cut, sourceRow));
  }
  return issues;
}

function issueForCut(cut: Cut, sourceRow: number): ImportDraft["issues"][number] {
  const cuts = [evidenceCut(cut)];
  const tag = cut.context.tag;
  switch (cut.kind) {
    case "css-property-removed":
      return { kind: "unsafe-style-removed", sourceRow, detail: { tag, property: cutField(cut, "property") }, cuts };
    case "attribute-removed":
      return { kind: "attribute-removed", sourceRow, detail: { tag, attribute: cutField(cut, "attribute") }, cuts };
    case "style-unparseable":
    case "tag-unwrapped":
    case "tag-removed":
    case "link-scheme-removed":
      return { kind: cut.kind, sourceRow, detail: { tag }, cuts };
    case "iframe-to-link":
      return { kind: "iframe-to-link", sourceRow, detail: {}, cuts };
    case "youtube-wrapper-emptied":
      return { kind: "youtube-wrapper-empty", sourceRow, detail: {}, cuts };
    case "markup-rebuilt":
      return { kind: "markup-rebuilt", sourceRow, detail: {}, cuts };
    case "editor-leftover":
      throw new Error("Editor leftovers are bundled into one issue");
    default: {
      const kind: never = cut.kind;
      throw new Error(`No Import issue for cut kind ${kind}`);
    }
  }
}

function cutField(cut: Cut, field: "attribute" | "property"): string {
  const value = cut.context[field];
  if (!value) throw new Error(`Cut ${cut.kind} at ${cut.start}–${cut.end} has no ${field}`);
  return value;
}

function evidenceCut(cut: Cut): ImportDraft["issues"][number]["cuts"][number] {
  return {
    start: cut.start,
    end: cut.end,
    kind: cut.kind,
    removedText: cut.removedText,
    replacement: cut.replacement ?? null,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
