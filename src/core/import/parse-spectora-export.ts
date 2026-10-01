import { decodeHTML } from "entities";
import readXlsxFile from "read-excel-file/node";
import { MAX_UPLOAD_BYTES, type Rejection } from "@/core/import/rejections";
import { sanitiseCommentHtml, type Cut } from "@/core/sanitise";
import type { Comment, ImportDraft, ImportIssue, Item, Section } from "@/core/import/schemas";

export type ParseResult = { ok: true; draft: ImportDraft } | { ok: false; rejection: Rejection };

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
} as const satisfies Record<string, (typeof EXPECTED_HEADERS)[number]>;

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

const REQUIRED_COLUMNS = [
  { header: COLUMNS.sectionName, short: "Section Name" },
  { header: COLUMNS.itemName, short: "Item Name" },
  { header: COLUMNS.commentName, short: "Comment Name" },
  { header: COLUMNS.commentText, short: "Comment Text" },
  { header: COLUMNS.commentType, short: "Comment Type" },
] as const;

const COMMENT_TYPES = ["info", "limit", "defect"] as const;
const ANSWER_TYPES = ["boolean", "checkbox", "number", "range", "text", "date"] as const;

type Cell = string | number | boolean | null;
type AnswerType = (typeof ANSWER_TYPES)[number];
type Category = -1 | 0 | 1;
type ColumnIndexes = Record<keyof typeof COLUMNS, number>;
type ParsedHeader = (typeof COLUMNS)[keyof typeof COLUMNS];

/** No matching header in this file. Read through `cellAt`, which treats it as an empty cell. */
const MISSING_COLUMN = -1;

/**
 * Turns a Spectora HTML Text export into an Import draft.
 * A column matches when its header, trimmed and lowercased, equals Spectora's verbatim header
 * or that header without its parenthetical hint. The first match wins.
 */
export async function parseSpectoraExport(bytes: Uint8Array, filename: string): Promise<ParseResult> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, rejection: { kind: "too-large", byteSize: bytes.byteLength, limit: MAX_UPLOAD_BYTES } };
  }
  if (!isXlsxZip(bytes)) return { ok: false, rejection: { kind: "not-xlsx" } };

  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(Buffer.from(bytes), { trim: false });
  } catch {
    return { ok: false, rejection: { kind: "unreadable-xlsx" } };
  }
  const sheet = sheets[0];
  if (!sheet) return { ok: false, rejection: { kind: "unreadable-xlsx" } };

  const headerRow = sheet.data[0];
  if (!headerRow || !hasNonBlankDataRow(sheet.data, headerRow.length)) {
    return { ok: false, rejection: { kind: "no-data-rows" } };
  }
  const headers = headerRow.map(headerText);
  const matched = matchHeaders(sheet.data, headers);
  const missing = missingRequired(matched);
  if (missing.length > 0) return { ok: false, rejection: { kind: "missing-columns", missing } };
  if (isPlainTextExport(sheet.data, matched.indexes, headers.length)) {
    return { ok: false, rejection: { kind: "plain-text-export" } };
  }
  const indexes = matched.indexes;
  const sourceRows: ImportDraft["sourceRows"] = [];
  const issues: ImportDraft["issues"] = fileShapeIssues(matched, sheets.map((entry) => entry.sheet));
  const sections: Section[] = [];
  let currentSection: Section | undefined;
  let currentItem: Item | undefined;
  let blankRows = 0;
  let valuesDecoded = 0;

  for (let index = 1; index < sheet.data.length; index++) {
    const cells = alignedCells(sheet.data[index], headers.length);
    if (cells.every(isBlankCell)) {
      blankRows += 1;
      continue;
    }

    const rowNumber = index + 1;
    sourceRows.push({ rowNumber, cells });
    for (const column of DECODED_COLUMNS) {
      const columnIndex = indexes[column];
      if (columnIndex === MISSING_COLUMN) continue;
      if (decodeCell(cellAt(cells, columnIndex)).decoded) valuesDecoded += 1;
    }

    const sectionName = trimmedName(cellAt(cells, indexes.sectionName), COLUMNS.sectionName, rowNumber, issues);
    const itemName = trimmedName(cellAt(cells, indexes.itemName), COLUMNS.itemName, rowNumber, issues);
    const commentName = trimmedName(cellAt(cells, indexes.commentName), COLUMNS.commentName, rowNumber, issues);
    const text = sanitiseCommentHtml(commentText(cellAt(cells, indexes.commentText)));
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

const NAME_AND_TEXT = ["sectionName", "itemName", "commentName", "commentText"] as const;
const HTML_TAG = /<\/?[A-Za-z]/;
/** Named (`&amp;`) or numeric (`&#38;`, `&#x26;`, `&#X26;`) character reference, including the semicolon. */
const ENTITY_AT_START = /^&(?:#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/;

/**
 * No Comment Text cell contains a tag, and a bare `&` (not the start of an entity)
 * appears in a name or Comment Text. Columns are found by header.
 */
function isPlainTextExport(
  data: readonly (readonly unknown[] | undefined)[],
  indexes: ColumnIndexes,
  width: number,
): boolean {
  const commentTextIndex = indexes.commentText;
  const nameAndTextIndexes = NAME_AND_TEXT.map((column) => indexes[column]);
  let bareAmpersand = false;
  for (let index = 1; index < data.length; index++) {
    const cells = alignedCells(data[index], width);
    if (HTML_TAG.test(commentText(cells[commentTextIndex]))) return false;
    for (const columnIndex of nameAndTextIndexes) {
      if (hasBareAmpersand(commentText(cells[columnIndex]))) bareAmpersand = true;
    }
  }
  return bareAmpersand;
}

function hasBareAmpersand(text: string): boolean {
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "&") {
      index += 1;
      continue;
    }
    const entity = ENTITY_AT_START.exec(text.slice(index));
    if (!entity) return true;
    index += entity[0].length;
  }
  return false;
}

function hasNonBlankDataRow(data: readonly (readonly unknown[] | undefined)[], width: number): boolean {
  for (let index = 1; index < data.length; index++) {
    if (!alignedCells(data[index], width).every(isBlankCell)) return true;
  }
  return false;
}

/** Office Open XML is a zip. Legacy .xls, CSV, PDF and any other bytes are not. */
function isXlsxZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Verbatim Spectora header, in file order. Optional columns missing from an export are flagged. */
const EXPECTED_HEADERS = [
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Unit Type Options (numeric answers only, comma-separated)",
  "Recommendation (from list)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
  "Default Value",
  'Default Value 2 (for "range" types)',
  'Default Unit Type (for "number" and "range" types)',
  "Default Location",
  "Default Estimate Min",
  "Default Estimate Max",
  "Locked",
  "Simple Format",
  "Disable Photos",
  "Uses",
  "Default Photo 1",
  "Default Photo 1 Caption",
  "Default Photo 2",
  "Default Photo 2 Caption",
  "Default Photo 3",
  "Default Photo 3 Caption",
  "Default Photo 4",
  "Default Photo 4 Caption",
  "Default Photo 5",
  "Default Photo 5 Caption",
  "Default Photo 6",
  "Default Photo 6 Caption",
  "Default Photo 7",
  "Default Photo 7 Caption",
  "Default Photo 8",
  "Default Photo 8 Caption",
  "Default Photo 9",
  "Default Photo 9 Caption",
  "Default Photo 10",
  "Default Photo 10 Caption",
  "Last Modified",
] as const;

const REQUIRED_HEADER_SET = new Set<string>(REQUIRED_COLUMNS.map((column) => column.header));

type HeaderMatch = {
  indexes: ColumnIndexes;
  found: Set<string>;
  unknown: { header: string; column: number }[];
};

function matchHeaders(data: readonly (readonly unknown[] | undefined)[], headers: readonly string[]): HeaderMatch {
  const found = new Set<string>();
  const indexByExpected = new Map<string, number>();
  const unknown: HeaderMatch["unknown"] = [];

  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index] ?? "";
    const expected = EXPECTED_HEADERS.find(
      (candidate) => !found.has(candidate) && matchesExpectedHeader(header, candidate),
    );
    if (expected) {
      found.add(expected);
      indexByExpected.set(expected, index);
      continue;
    }
    if (isBlankHeader(header) && !columnHasContent(data, index, headers.length)) continue;
    unknown.push({ header, column: index + 1 });
  }

  return { indexes: columnIndexes(indexByExpected), found, unknown };
}

function columnIndexes(indexByExpected: ReadonlyMap<string, number>): ColumnIndexes {
  const indexOf = (header: ParsedHeader) => indexByExpected.get(header) ?? MISSING_COLUMN;
  return {
    sectionName: indexOf(COLUMNS.sectionName),
    itemName: indexOf(COLUMNS.itemName),
    commentName: indexOf(COLUMNS.commentName),
    commentText: indexOf(COLUMNS.commentText),
    commentType: indexOf(COLUMNS.commentType),
    category: indexOf(COLUMNS.category),
    choiceOptions: indexOf(COLUMNS.choiceOptions),
    unitOptions: indexOf(COLUMNS.unitOptions),
    recommendation: indexOf(COLUMNS.recommendation),
    answerType: indexOf(COLUMNS.answerType),
    defaultValue: indexOf(COLUMNS.defaultValue),
  };
}

function missingRequired(matched: HeaderMatch): string[] {
  return REQUIRED_COLUMNS.filter((column) => !matched.found.has(column.header)).map((column) => column.short);
}

function fileShapeIssues(matched: HeaderMatch, sheetNames: readonly string[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const header of EXPECTED_HEADERS) {
    if (REQUIRED_HEADER_SET.has(header) || matched.found.has(header)) continue;
    issues.push({
      kind: "expected-column-missing",
      sourceRow: null,
      detail: { column: columnLabel(header) },
      cuts: [],
    });
  }
  for (const column of matched.unknown) {
    issues.push({ kind: "unknown-column", sourceRow: null, detail: column, cuts: [] });
  }
  if (sheetNames.length > 1) {
    issues.push({
      kind: "extra-sheet",
      sourceRow: null,
      detail: { sheets: sheetNames.slice(1) },
      cuts: [],
    });
  }
  return issues;
}

function columnHasContent(
  data: readonly (readonly unknown[] | undefined)[],
  column: number,
  width: number,
): boolean {
  for (let index = 1; index < data.length; index += 1) {
    if (!isBlankCell(alignedCells(data[index], width)[column] ?? null)) return true;
  }
  return false;
}

/** Trailing parenthetical on a Spectora header, such as `(info, limit, defect)`. */
const TRAILING_HINT = /\s*\([^)]*\)\s*$/;

function matchesExpectedHeader(fileHeader: string, expected: string): boolean {
  const file = fileHeader.trim().toLowerCase();
  return file === expected.trim().toLowerCase() || file === withoutHint(expected);
}

function withoutHint(header: string): string {
  return header.trim().toLowerCase().replace(TRAILING_HINT, "").trim();
}

function isBlankHeader(header: string): boolean {
  return header.trim() === "";
}

function columnLabel(header: string): string {
  return header.replace(TRAILING_HINT, "").trim();
}

function buildComment(cells: Cell[], indexes: ColumnIndexes, rowNumber: number, name: string, textHtml: string): Comment {
  const commentType = matchAllowedValue(cellAt(cells, indexes.commentType), COMMENT_TYPES, "info");
  const answerType = matchAllowedValue(cellAt(cells, indexes.answerType), ANSWER_TYPES, "boolean");
  const defaults = defaultsOf(answerType, cellAt(cells, indexes.defaultValue));
  return {
    sourceRow: rowNumber,
    name,
    textHtml,
    commentType,
    category: categoryOf(cellAt(cells, indexes.category)),
    recommendation: recommendationOf(cellAt(cells, indexes.recommendation)),
    answerType,
    defaultBoolean: defaults.defaultBoolean,
    defaultText: defaults.defaultText,
    choiceOptions: optionsOf(cellAt(cells, indexes.choiceOptions)),
    unitOptions: optionsOf(cellAt(cells, indexes.unitOptions)),
  };
}

function cellAt(cells: Cell[], index: number): Cell {
  if (index === MISSING_COLUMN || index >= cells.length) return null;
  return cells[index] ?? null;
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

function alignedCells(row: readonly unknown[] | undefined, width: number): Cell[] {
  return align(row, width).map(storedCell);
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

function issuesFromCuts(cuts: readonly Cut[], sourceRow: number): ImportIssue[] {
  const bundled = cuts.filter(isBundled);
  const issues: ImportIssue[] = [];
  if (bundled.length > 0) {
    issues.push({
      kind: "editor-leftovers",
      sourceRow,
      detail: { count: bundled.length },
      cuts: bundled.map(evidenceCut),
    });
  }
  for (const cut of cuts) {
    if (!isBundled(cut)) issues.push(issueForCut(cut, sourceRow));
  }
  return issues;
}

function issueForCut(cut: Cut, sourceRow: number): ImportIssue {
  const cuts = [evidenceCut(cut)];
  const tag = cut.context.tag;
  switch (cut.kind) {
    case "css-property-removed":
      return { kind: "unsafe-style-removed", sourceRow, detail: { tag, property: contextField(cut, "property") }, cuts };
    case "attribute-removed":
      return { kind: "attribute-removed", sourceRow, detail: { tag, attribute: contextField(cut, "attribute") }, cuts };
    case "style-unparseable":
    case "tag-unwrapped":
    case "tag-removed":
    case "link-scheme-removed":
      return { kind: cut.kind, sourceRow, detail: { tag }, cuts };
    case "iframe-to-link":
    case "markup-rebuilt":
      return { kind: cut.kind, sourceRow, detail: {}, cuts };
    case "youtube-wrapper-emptied":
      return { kind: "youtube-wrapper-empty", sourceRow, detail: {}, cuts };
    case "editor-leftover":
      throw new Error("Editor leftovers are bundled into one issue");
    default: {
      const kind: never = cut.kind;
      throw new Error(`No Import issue for cut kind ${kind}`);
    }
  }
}

function contextField(cut: Cut, field: "attribute" | "property"): string {
  const value = cut.context[field];
  if (!value) throw new Error(`Cut ${cut.kind} at ${cut.start}–${cut.end} has no ${field}`);
  return value;
}

function evidenceCut(cut: Cut): ImportIssue["cuts"][number] {
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
