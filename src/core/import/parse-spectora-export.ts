import { decodeHTML } from "entities";
import readXlsxFile from "read-excel-file/node";
import { sanitiseCommentHtml } from "@/core/sanitise";
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
      if (decodingChanged(cells[indexes[column]])) valuesDecoded += 1;
    }

    const sectionName = trimmedName(cells[indexes.sectionName], "Section Name", rowNumber, issues);
    const itemName = trimmedName(cells[indexes.itemName], "Item Name", rowNumber, issues);
    const commentName = trimmedName(cells[indexes.commentName], "Comment Name", rowNumber, issues);
    const comment = buildComment(cells, indexes, rowNumber, commentName);

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

function columnIndexes(headers: string[]): Record<keyof typeof COLUMNS, number> {
  const indexes = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, header] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const want = header.trim().toLowerCase();
    const index = headers.findIndex((cell) => cell.trim().toLowerCase() === want);
    if (index < 0) throw new Error(`Missing column: ${header}`);
    indexes[key] = index;
  }
  return indexes;
}

function buildComment(
  cells: Cell[],
  indexes: Record<keyof typeof COLUMNS, number>,
  rowNumber: number,
  name: string,
): Comment {
  const commentType = vocabulary(cells[indexes.commentType], COMMENT_TYPES, "info");
  const answerType = vocabulary(cells[indexes.answerType], ANSWER_TYPES, "boolean");
  const defaults = defaultsOf(answerType, cells[indexes.defaultValue]);
  return {
    sourceRow: rowNumber,
    name,
    textHtml: sanitiseCommentHtml(commentText(cells[indexes.commentText])).html,
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

function vocabulary<T extends string>(value: Cell, allowed: readonly T[], fallback: T): T {
  const text = decodeCell(value).text.trim().toLowerCase();
  return allowed.find((entry) => entry === text) ?? fallback;
}

function categoryOf(value: Cell): -1 | 0 | 1 | null {
  if (typeof value === "number") return value === -1 || value === 0 || value === 1 ? value : null;
  const text = decodeCell(value).text.trim();
  if (text === "") return null;
  const numeric = Number(text);
  return numeric === -1 || numeric === 0 || numeric === 1 ? numeric : null;
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

function decodingChanged(value: Cell): boolean {
  return typeof value === "string" && decodeHTML(value) !== value;
}

function suggestedName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const withoutDate = withoutExtension.replace(/ *-[ ]*\d{4}-\d{2}-\d{2}$/, "").trim();
  if (withoutDate !== "") return withoutDate;
  const fallback = withoutExtension.trim();
  return fallback !== "" ? fallback : "Untitled Template";
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

/** The only change made to a raw cell: a Date becomes an ISO 8601 string. */
function storedCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function isBlankCell(value: Cell): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
