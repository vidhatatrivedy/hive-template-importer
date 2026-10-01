import { decodeHTML } from "entities";
import readXlsxFile from "read-excel-file/node";
import { MAX_UPLOAD_BYTES, type Rejection } from "@/core/import/rejections";
import { sanitiseCommentHtml, type Cut } from "@/core/sanitise";
import type { Comment, ImportDraft, ImportIssue, Item, Section } from "@/core/import/schemas";
import { untitledName } from "@/core/import/untitled-name";

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
  const fileIssueCount = issues.length;
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
    const comment = buildComment(cells, indexes, rowNumber, commentName, text.html, issues);

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
  issues.splice(fileIssueCount, 0, ...contentIssues(headers, sourceRows));
  issues.push(...structureIssues(sections));

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

/** Kept in the Source row. Order and Last Modified are never flagged; estimates have their own issues. */
const RAW_ONLY_COLUMNS = [
  'Default Value 2 (for "range" types)',
  'Default Unit Type (for "number" and "range" types)',
  "Default Location",
  "Locked",
  "Simple Format",
  "Disable Photos",
  "Uses",
] as const;

const DEFAULT_PHOTO_COLUMNS = EXPECTED_HEADERS.filter((header) => header.startsWith("Default Photo"));
const ESTIMATE_MIN = "Default Estimate Min";
const ESTIMATE_MAX = "Default Estimate Max";
const USES = "Uses";
const STOCK_ESTIMATE_MIN = 10;
const STOCK_ESTIMATE_MAX = 1000;

function contentIssues(headers: readonly string[], sourceRows: ImportDraft["sourceRows"]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const header of RAW_ONLY_COLUMNS) {
    const column = headerIndex(headers, header);
    if (column < 0) continue;
    const rows = rowsWithContent(sourceRows, column, header === USES);
    if (rows.length === 0) continue;
    issues.push(rawOnlyIssue(columnLabel(header), rows));
  }

  const photoColumns = DEFAULT_PHOTO_COLUMNS.map((header) => headerIndex(headers, header)).filter((column) => column >= 0);
  if (photoColumns.length > 0) {
    const rows = sourceRows
      .filter((row) => photoColumns.some((column) => !isBlankCell(row.cells[column] ?? null)))
      .map((row) => row.rowNumber);
    if (rows.length > 0) issues.push(rawOnlyIssue("Default photos", rows));
  }

  const estimates = estimateIssue(headers, sourceRows);
  if (estimates) issues.push(estimates);
  return issues;
}

function rawOnlyIssue(column: string, rows: number[]): ImportIssue {
  return { kind: "raw-only-content", sourceRow: null, detail: { column, rows }, cuts: [] };
}

function rowsWithContent(sourceRows: ImportDraft["sourceRows"], column: number, uses: boolean): number[] {
  return sourceRows
    .filter((row) => {
      const value = row.cells[column] ?? null;
      if (uses) return !isUsesDefault(value);
      return !isBlankCell(value);
    })
    .map((row) => row.rowNumber);
}

/** Null is the default. Uses is also default at 0, including the string `"0"`. */
function isUsesDefault(value: Cell): boolean {
  return isBlankCell(value) || value === 0 || value === "0";
}

function estimateIssue(headers: readonly string[], sourceRows: ImportDraft["sourceRows"]): ImportIssue | null {
  const minColumn = headerIndex(headers, ESTIMATE_MIN);
  const maxColumn = headerIndex(headers, ESTIMATE_MAX);
  if (minColumn < 0 && maxColumn < 0) return null;

  const stock: number[] = [];
  const custom: number[] = [];
  for (const row of sourceRows) {
    const min = minColumn < 0 ? null : (row.cells[minColumn] ?? null);
    const max = maxColumn < 0 ? null : (row.cells[maxColumn] ?? null);
    if (isStockEstimate(min, max)) stock.push(row.rowNumber);
    else if (isCustomEstimate(min, max)) custom.push(row.rowNumber);
  }
  if (custom.length > 0) return { kind: "custom-estimates", sourceRow: null, detail: { rows: custom }, cuts: [] };
  if (stock.length > 0) return { kind: "stock-estimates", sourceRow: null, detail: { count: stock.length }, cuts: [] };
  return null;
}

function isStockEstimate(min: Cell, max: Cell): boolean {
  return sameNumber(min, STOCK_ESTIMATE_MIN) && sameNumber(max, STOCK_ESTIMATE_MAX);
}

function isCustomEstimate(min: Cell, max: Cell): boolean {
  const minCustom = !isBlankCell(min) && !sameNumber(min, STOCK_ESTIMATE_MIN);
  const maxCustom = !isBlankCell(max) && !sameNumber(max, STOCK_ESTIMATE_MAX);
  return minCustom || maxCustom;
}

/** A number and its decimal string form are the same estimate. `"10.0"` is not `"10"`. */
function sameNumber(value: Cell, expected: number): boolean {
  return value === expected || value === String(expected);
}

function headerIndex(headers: readonly string[], expected: string): number {
  return headers.findIndex((header) => matchesExpectedHeader(header, expected));
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

function buildComment(
  cells: Cell[],
  indexes: ColumnIndexes,
  rowNumber: number,
  name: string,
  textHtml: string,
  issues: ImportDraft["issues"],
): Comment {
  const commentType = vocabularyValue({
    value: cellAt(cells, indexes.commentType),
    columnIndex: indexes.commentType,
    allowed: COMMENT_TYPES,
    fallback: "info",
    field: COLUMNS.commentType,
    fallbackKind: "comment-type-fallback",
    rowNumber,
    issues,
  });
  const answerType = vocabularyValue({
    value: cellAt(cells, indexes.answerType),
    columnIndex: indexes.answerType,
    allowed: ANSWER_TYPES,
    fallback: "boolean",
    field: COLUMNS.answerType,
    fallbackKind: "answer-type-fallback",
    rowNumber,
    issues,
  });
  const choiceOptions = optionsOf(
    cellAt(cells, indexes.choiceOptions),
    COLUMNS.choiceOptions,
    rowNumber,
    issues,
    answerType !== "checkbox",
  );
  const unitOptions = optionsOf(cellAt(cells, indexes.unitOptions), COLUMNS.unitOptions, rowNumber, issues, false);
  const defaults = defaultsOf(answerType, cellAt(cells, indexes.defaultValue), choiceOptions, rowNumber, issues);
  return {
    sourceRow: rowNumber,
    name,
    textHtml,
    commentType,
    category: categoryValue(cellAt(cells, indexes.category), indexes.category, commentType, rowNumber, issues),
    recommendation: recommendationOf(cellAt(cells, indexes.recommendation)),
    answerType,
    defaultBoolean: defaults.defaultBoolean,
    defaultText: defaults.defaultText,
    choiceOptions,
    unitOptions,
  };
}

function cellAt(cells: Cell[], index: number): Cell {
  if (index === MISSING_COLUMN || index >= cells.length) return null;
  return cells[index] ?? null;
}

/**
 * Decode, then trim. A blank result is the Untitled fallback and `blank-name` only:
 * that warning replaces a trim notice for the same cell. Grouping uses this fallback,
 * so consecutive blank names stay one Section or Item.
 */
function trimmedName(value: Cell, field: string, rowNumber: number, issues: ImportDraft["issues"]): string {
  const decoded = decodeCell(value);
  const name = decoded.text.trim();
  if (name === "") {
    issues.push({ kind: "blank-name", sourceRow: rowNumber, detail: { field }, cuts: [] });
    return untitledName(field);
  }
  if (name !== decoded.text) {
    issues.push({ kind: "whitespace-trimmed", sourceRow: rowNumber, detail: { field }, cuts: [] });
  }
  return name;
}

type NameRun = { name: string; firstRow: number; lastRow: number };

/**
 * A later Section run, or a later Item run inside one Section run, whose name matches
 * an earlier run. Comments that share a normalised name and stored Comment type inside
 * one Item run are duplicates: every one after the first is flagged, and none is removed.
 * A repeated name in a different run is not a duplicate.
 */
function structureIssues(sections: readonly Section[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const sectionRuns: NameRun[] = [];
  for (const section of sections) {
    const rows = section.items.flatMap((item) => rowNumbers(item.comments));
    const split = recordRun(sectionRuns, "section", section.name, rows);
    if (split) issues.push(split);
    issues.push(...itemStructureIssues(section));
  }
  return issues;
}

function itemStructureIssues(section: Section): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const itemRuns: NameRun[] = [];
  for (const item of section.items) {
    const split = recordRun(itemRuns, "item", item.name, rowNumbers(item.comments));
    if (split) issues.push(split);
    issues.push(...duplicateIssues(item));
  }
  return issues;
}

type DuplicateGroup = { name: string; commentType: Comment["commentType"]; rows: number[] };

function duplicateIssues(item: Item): ImportIssue[] {
  const groups: DuplicateGroup[] = [];
  for (const comment of item.comments) {
    if (comment.sourceRow === null) continue;
    const group = groups.find(
      (candidate) => candidate.name === comment.name && candidate.commentType === comment.commentType,
    );
    if (group) group.rows.push(comment.sourceRow);
    else groups.push({ name: comment.name, commentType: comment.commentType, rows: [comment.sourceRow] });
  }

  const issues: ImportIssue[] = [];
  for (const group of groups) {
    if (group.rows.length < 2) continue;
    for (const sourceRow of group.rows.slice(1)) {
      issues.push({
        kind: "duplicate-comment",
        sourceRow,
        detail: { name: group.name, commentType: group.commentType, rows: [...group.rows] },
        cuts: [],
      });
    }
  }
  return issues;
}

function splitRunIssue(level: "section" | "item", run: NameRun, earlier: readonly NameRun[]): ImportIssue {
  return {
    kind: "split-run",
    sourceRow: run.firstRow,
    detail: {
      level,
      name: run.name,
      firstRow: run.firstRow,
      lastRow: run.lastRow,
      earlierRuns: earlier.map((candidate) => ({ firstRow: candidate.firstRow, lastRow: candidate.lastRow })),
    },
    cuts: [],
  };
}

/** Records this run. Returns a split-run issue when an earlier run already used the name. */
function recordRun(
  runs: NameRun[],
  level: "section" | "item",
  name: string,
  rows: readonly number[],
): ImportIssue | null {
  const run = nameRun(name, rows);
  if (!run) return null;
  const earlier = runs.filter((candidate) => candidate.name === run.name);
  runs.push(run);
  return earlier.length > 0 ? splitRunIssue(level, run, earlier) : null;
}

function nameRun(name: string, rows: readonly number[]): NameRun | null {
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  if (firstRow === undefined || lastRow === undefined) return null;
  return { name, firstRow, lastRow };
}

function rowNumbers(comments: readonly Comment[]): number[] {
  const rows: number[] = [];
  for (const comment of comments) {
    if (comment.sourceRow !== null) rows.push(comment.sourceRow);
  }
  return rows;
}

function commentText(value: Cell): string {
  return typeof value === "string" ? value : "";
}

/**
 * Decode, trim, lowercase. A known value that changed on screen gets `vocabulary-normalised`.
 * An unknown or blank value gets the fallback issue instead of that notice. A missing column
 * falls back quietly: the file-level missing-column issue already names it.
 * A number or boolean is read as its string form and that conversion is not flagged.
 */
function vocabularyValue<T extends string>(input: {
  value: Cell;
  columnIndex: number;
  allowed: readonly T[];
  fallback: T;
  field: string;
  fallbackKind: "comment-type-fallback" | "answer-type-fallback";
  rowNumber: number;
  issues: ImportDraft["issues"];
}): T {
  const { value, columnIndex, allowed, fallback, field, fallbackKind, rowNumber, issues } = input;
  if (columnIndex === MISSING_COLUMN) return fallback;
  const decoded = decodeCell(value);
  const match = allowed.find((entry) => entry === decoded.text.trim().toLowerCase());
  if (!match) {
    issues.push({ kind: fallbackKind, sourceRow: rowNumber, detail: {}, cuts: [] });
    return fallback;
  }
  if (typeof value === "string" && decoded.text !== match) {
    issues.push({ kind: "vocabulary-normalised", sourceRow: rowNumber, detail: { field }, cuts: [] });
  }
  return match;
}

/**
 * Read numerically: `"0"`, `0` and `0.0` are 0, and that string form is not flagged.
 * A missing column stays empty without a row issue.
 */
function categoryValue(
  value: Cell,
  columnIndex: number,
  commentType: (typeof COMMENT_TYPES)[number],
  rowNumber: number,
  issues: ImportDraft["issues"],
): Category | null {
  if (columnIndex === MISSING_COLUMN) return null;
  const category = validCategory(categoryNumber(value));
  if (commentType === "defect") {
    if (category !== null) return category;
    issues.push({ kind: "category-missing", sourceRow: rowNumber, detail: {}, cuts: [] });
    return null;
  }
  if (category === null) return null;
  issues.push({ kind: "category-orphan", sourceRow: rowNumber, detail: { category }, cuts: [] });
  return category;
}

function validCategory(numeric: number | null): Category | null {
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

/**
 * Boolean: `true`/`t` and `false`/`f`, case-insensitive after trim. Exact `true`/`false`
 * and an xlsx boolean cell are stored with no notice. Any other non-blank value is dropped.
 * Other answer types keep the decoded, trimmed text. A trim is `whitespace-trimmed` except on boolean.
 */
function defaultsOf(
  answerType: AnswerType,
  value: Cell,
  choiceOptions: readonly string[],
  rowNumber: number,
  issues: ImportDraft["issues"],
): { defaultBoolean: boolean | null; defaultText: string | null } {
  if (answerType === "boolean") return booleanDefault(value, rowNumber, issues);
  const decoded = decodeCell(value);
  const text = decoded.text.trim();
  if (typeof value === "string" && text !== decoded.text) {
    issues.push({ kind: "whitespace-trimmed", sourceRow: rowNumber, detail: { field: COLUMNS.defaultValue }, cuts: [] });
  }
  if (text === "") return { defaultBoolean: null, defaultText: null };
  if (answerType === "checkbox" && !choiceOptions.includes(text)) {
    issues.push({ kind: "checkbox-default-not-in-options", sourceRow: rowNumber, detail: { value: text }, cuts: [] });
  }
  return { defaultBoolean: null, defaultText: text };
}

function booleanDefault(
  value: Cell,
  rowNumber: number,
  issues: ImportDraft["issues"],
): { defaultBoolean: boolean | null; defaultText: string | null } {
  if (value === true || value === false) return { defaultBoolean: value, defaultText: null };
  const text = decodeCell(value).text.trim();
  if (text === "") return { defaultBoolean: null, defaultText: null };
  const canonical = booleanFromText(text);
  if (canonical === null) {
    issues.push({ kind: "boolean-default-invalid", sourceRow: rowNumber, detail: {}, cuts: [] });
    return { defaultBoolean: null, defaultText: null };
  }
  const exact = canonical ? "true" : "false";
  if (value !== exact) {
    issues.push({ kind: "boolean-default-normalised", sourceRow: rowNumber, detail: { value: canonical }, cuts: [] });
  }
  return { defaultBoolean: canonical, defaultText: null };
}

/** `true`/`t` and `false`/`f`, after the caller has trimmed. */
function booleanFromText(text: string): boolean | null {
  const lower = text.toLowerCase();
  if (lower === "true" || lower === "t") return true;
  if (lower === "false" || lower === "f") return false;
  return null;
}

/**
 * Split on commas, then decode and trim each entry. Empty entries are dropped, once per cell.
 * Duplicates stay. Choice options on a non-checkbox answer are kept and flagged.
 */
function optionsOf(
  value: Cell,
  field: string,
  rowNumber: number,
  issues: ImportDraft["issues"],
  orphan: boolean,
): string[] {
  if (value === null) return [];
  const text = typeof value === "string" ? value : String(value);
  if (text.trim() === "") return [];
  let dropped = false;
  const entries: string[] = [];
  for (const part of text.split(",")) {
    const entry = decodeHTML(part).trim();
    if (entry === "") dropped = true;
    else entries.push(entry);
  }
  if (dropped) {
    issues.push({ kind: "empty-option-dropped", sourceRow: rowNumber, detail: { field }, cuts: [] });
  }
  if (orphan && entries.length > 0) {
    issues.push({ kind: "options-orphan", sourceRow: rowNumber, detail: {}, cuts: [] });
  }
  return entries;
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
