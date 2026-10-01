import { decodeHTML } from "entities";
import type { IssueKind } from "@/core/import/catalogue";
import type { Comment, EditableTree, ImportEvidence, ImportIssue, Item, Section } from "@/core/import/schemas";
import { applyCuts, type Cut } from "@/core/sanitise";

export type Cell = string | number | boolean | null;

/**
 * Import issue kinds, or a named rule. A null explanation is an Unexplained difference.
 * `category-dropped` is an invalid Category on an info or limit Comment, discarded with no issue.
 */
export type DifferenceExplanation =
  | { issues: IssueKind[] }
  | { rule: "entity-decoding" | "category-dropped" | "option-list" };

export type Difference = {
  column: string;
  raw: Cell;
  stored: Cell;
  explanation: DifferenceExplanation | null;
};

export type ExportRow = {
  sourceRow: number | null;
  cells: Cell[];
};

export type ReconcileRow = {
  sourceRow: number | null;
  /** ✓ when every difference is explained; ✗ when any is Unexplained. */
  status: "✓" | "✗";
  differences: Difference[];
};

export type ReconcileResult = {
  rows: ReconcileRow[];
  verified: number;
  total: number;
  explained: number;
  unexplained: number;
};

const SECTION_NAME = "Section Name";
const ITEM_NAME = "Item Name";
const COMMENT_NAME = "Comment Name";
const COMMENT_TEXT = "Comment Text";
const COMMENT_TYPE = "Comment Type (info, limit, defect)";
const CATEGORY = "Category (-1: Low, 0: Med, 1: High)";
const CHOICE_OPTIONS = "Multiple Choice Options (comma-separated)";
const UNIT_OPTIONS = "Unit Type Options (numeric answers only, comma-separated)";
const RECOMMENDATION = "Recommendation (from list)";
const ANSWER_TYPE = "Answer Type (boolean, checkbox, date, number, range, text)";
const DEFAULT_VALUE = "Default Value";

const NAME_COLUMNS = [SECTION_NAME, ITEM_NAME, COMMENT_NAME, RECOMMENDATION];

/** Copied, not imported from the parser, so a parser bug cannot explain itself away. */
const COMMENT_TYPES = ["info", "limit", "defect"] as const;
const ANSWER_TYPES = ["boolean", "checkbox", "number", "range", "text", "date"] as const;

type SourceRow = ImportEvidence["sourceRows"][number];

type PlacedComment = {
  section: Section;
  item: Item;
  comment: Comment;
};

/** A Comment in tree order, with the difference list its check writes into. */
type CheckedComment = PlacedComment & {
  differences: Difference[];
  source: SourceRow | null;
};

/**
 * One row per Comment in tree order. Typed columns come from the tree; every other column
 * is copied from that Comment's Source row, or null when it has none.
 */
export function toExportRows(tree: EditableTree, evidence: ImportEvidence): ExportRow[] {
  const headers = evidence.run.headers;
  const sourceByRow = indexSourceRows(evidence);
  return walk(tree).map(({ section, item, comment }) => {
    const source = sourceRowOf(comment, sourceByRow);
    const cells = source ? copyCells(source.cells, headers.length) : blankCells(headers.length);
    writeTypedCells(cells, headers, section, item, comment);
    return { sourceRow: comment.sourceRow, cells };
  });
}

/**
 * Proves a stored tree matches its Source rows. Field checks use entity decoding, trimming
 * and cut replay, and do not call the parser.
 */
export function reconcile(evidence: ImportEvidence, tree: EditableTree): ReconcileResult {
  const headers = evidence.run.headers;
  const sourceByRow = indexSourceRows(evidence);
  const issuesByRow = indexIssues(evidence.issues);
  const differencesByRow = new Map<number, Difference[]>();
  for (const source of evidence.sourceRows) differencesByRow.set(source.rowNumber, []);

  const exported = toExportRows(tree, evidence);
  const checked: CheckedComment[] = [];
  const commentCount = new Map<number, number>();

  // A sourced Comment shares its Source row's difference list, so later order and boundary
  // flags land on that row. A Comment with no Source row keeps a list of its own.
  for (const [index, placed] of walk(tree).entries()) {
    const cells = exported[index]?.cells ?? blankCells(headers.length);
    const source = sourceRowOf(placed.comment, sourceByRow);
    const differences = source ? differencesByRow.get(source.rowNumber) : undefined;
    if (source && differences) {
      differences.push(...fieldDifferences(headers, cells, source, issuesByRow.get(source.rowNumber) ?? []));
      commentCount.set(source.rowNumber, (commentCount.get(source.rowNumber) ?? 0) + 1);
      checked.push({ ...placed, differences, source });
    } else {
      checked.push({
        ...placed,
        differences: [{ column: "Source row", raw: placed.comment.sourceRow, stored: null, explanation: null }],
        source: null,
      });
    }
  }

  for (const source of evidence.sourceRows) {
    const count = commentCount.get(source.rowNumber) ?? 0;
    const differences = differencesByRow.get(source.rowNumber);
    if (!differences) continue;
    if (count === 0) {
      differences.push({ column: "Comment", raw: source.rowNumber, stored: null, explanation: null });
    } else if (count > 1) {
      differences.push({ column: "Comment", raw: source.rowNumber, stored: count, explanation: null });
    }
  }

  flagSourceRowOrder(checked);
  flagBoundaries(checked, headers);
  flagSplitRuns(evidence.sourceRows, headers, issuesByRow, differencesByRow);

  const rows: ReconcileRow[] = [];
  for (const source of evidence.sourceRows) {
    rows.push(toRow(source.rowNumber, differencesByRow.get(source.rowNumber) ?? []));
  }
  for (const entry of checked) {
    if (entry.source === null) rows.push(toRow(entry.comment.sourceRow, entry.differences));
  }
  rows.push(...emptyStructure(tree));

  return { rows, ...tally(rows) };
}

function walk(tree: EditableTree): PlacedComment[] {
  const placed: PlacedComment[] = [];
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) placed.push({ section, item, comment });
    }
  }
  return placed;
}

function indexSourceRows(evidence: ImportEvidence): Map<number, SourceRow> {
  return new Map(evidence.sourceRows.map((row) => [row.rowNumber, row]));
}

function sourceRowOf(comment: Comment, sourceByRow: ReadonlyMap<number, SourceRow>): SourceRow | undefined {
  if (comment.sourceRow === null) return undefined;
  return sourceByRow.get(comment.sourceRow);
}

function indexIssues(issues: readonly ImportIssue[]): Map<number, ImportIssue[]> {
  const byRow = new Map<number, ImportIssue[]>();
  for (const issue of issues) {
    if (issue.sourceRow === null) continue;
    const list = byRow.get(issue.sourceRow);
    if (list) list.push(issue);
    else byRow.set(issue.sourceRow, [issue]);
  }
  return byRow;
}

function writeTypedCells(cells: Cell[], headers: readonly string[], section: Section, item: Item, comment: Comment): void {
  const values: [string, Cell][] = [
    [SECTION_NAME, section.name],
    [ITEM_NAME, item.name],
    [COMMENT_NAME, comment.name],
    [COMMENT_TEXT, comment.textHtml],
    [COMMENT_TYPE, comment.commentType],
    [CATEGORY, comment.category],
    [CHOICE_OPTIONS, optionCell(comment.choiceOptions)],
    [UNIT_OPTIONS, optionCell(comment.unitOptions)],
    [RECOMMENDATION, comment.recommendation],
    [ANSWER_TYPE, comment.answerType],
    [DEFAULT_VALUE, defaultCell(comment)],
  ];
  for (const [header, value] of values) {
    const index = columnIndex(headers, header);
    if (index >= 0) cells[index] = value;
  }
}

function optionCell(options: readonly string[]): Cell {
  return options.length === 0 ? null : options.join(", ");
}

function defaultCell(comment: Comment): Cell {
  if (comment.defaultBoolean === true) return "true";
  if (comment.defaultBoolean === false) return "false";
  return comment.defaultText;
}

function fieldDifferences(
  headers: readonly string[],
  storedCells: readonly Cell[],
  source: SourceRow,
  issues: readonly ImportIssue[],
): Difference[] {
  const differences: Difference[] = [];
  const commentType = cellForHeader(headers, storedCells, COMMENT_TYPE);
  const answerType = cellForHeader(headers, storedCells, ANSWER_TYPE);
  const choiceOptions = cellForHeader(headers, storedCells, CHOICE_OPTIONS);
  for (let index = 0; index < headers.length; index += 1) {
    const column = headers[index] ?? "";
    const raw = index < source.cells.length ? (source.cells[index] ?? null) : null;
    const stored = storedCells[index] ?? null;
    const difference = compareCell(column, raw, stored, issues, commentType, answerType, choiceOptions);
    if (difference) differences.push(difference);
  }
  return differences;
}

function compareCell(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
  commentType: Cell,
  answerType: Cell,
  choiceOptions: Cell,
): Difference | null {
  if (matchesExpectedHeader(column, COMMENT_TEXT)) return commentTextDifference(column, raw, stored, issues);
  if (matchesAny(column, NAME_COLUMNS)) return nameDifference(column, raw, stored, issues);
  if (matchesExpectedHeader(column, CATEGORY)) return categoryDifference(column, raw, stored, issues, commentType);
  if (matchesExpectedHeader(column, COMMENT_TYPE)) {
    return vocabularyDifference(column, raw, stored, issues, COMMENT_TYPES, "info", "comment-type-fallback");
  }
  if (matchesExpectedHeader(column, ANSWER_TYPE)) {
    return vocabularyDifference(column, raw, stored, issues, ANSWER_TYPES, "boolean", "answer-type-fallback");
  }
  if (matchesExpectedHeader(column, DEFAULT_VALUE)) {
    return defaultDifference(column, raw, stored, issues, answerType, choiceOptions);
  }
  if (matchesExpectedHeader(column, CHOICE_OPTIONS) || matchesExpectedHeader(column, UNIT_OPTIONS)) {
    return optionDifference(column, raw, stored, issues, matchesExpectedHeader(column, CHOICE_OPTIONS), answerType);
  }
  return equalityDifference(column, raw, stored);
}

/** `changed: false` means the stored text matches. `explanation: null` means it changed and nothing explains it. */
type ValueChange = { changed: false } | { changed: true; explanation: DifferenceExplanation | null };

/**
 * A boolean default of `f`/`t` or odd case needs `boolean-default-normalised`.
 * Anything else non-blank needs `boolean-default-invalid`. Exact `true`/`false` and an xlsx
 * boolean cell are not a difference. Other answer types follow names: decoding, then trim.
 * A checkbox default that isn't a stored choice option is a difference even when the text matches.
 */
function defaultDifference(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
  answerType: Cell,
  choiceOptions: Cell,
): Difference | null {
  if (answerType === "boolean") return booleanDefaultDifference(column, raw, stored, issues);
  const diff = textDefaultDifference(column, raw, stored, issues);
  if (answerType !== "checkbox") return diff;
  const storedText = typeof stored === "string" ? stored : null;
  if (storedText === null || storedText === "") return diff;
  if (splitOptions(choiceOptions).includes(storedText)) return diff;
  const change: ValueChange =
    diff === null ? { changed: false } : { changed: true, explanation: diff.explanation };
  return withCheckIssue(column, raw, stored, change, issues, "checkbox-default-not-in-options");
}

function booleanDefaultDifference(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
): Difference | null {
  if (raw === true || raw === false) {
    const expected = raw ? "true" : "false";
    if (stored === expected) return null;
    return { column, raw, stored, explanation: null };
  }
  const text = cellText(raw).trim();
  if (text === "") {
    if (stored === null) return null;
    return { column, raw, stored, explanation: null };
  }
  const canonical = canonicalBooleanText(text);
  if (canonical === null) {
    if (stored !== null) return { column, raw, stored, explanation: null };
    return { column, raw, stored, explanation: explanationForKind(issues, "boolean-default-invalid") };
  }
  if (stored !== canonical) return { column, raw, stored, explanation: null };
  if (raw === canonical) return null;
  return { column, raw, stored, explanation: explanationForKind(issues, "boolean-default-normalised") };
}

/** `true`/`t` and `false`/`f` as the stored words. Own copy of the parser's rule. */
function canonicalBooleanText(text: string): "true" | "false" | null {
  const lower = text.toLowerCase();
  if (lower === "true" || lower === "t") return "true";
  if (lower === "false" || lower === "f") return "false";
  return null;
}

/** A non-boolean default. A number or boolean cell's string form is not a difference. */
function textDefaultDifference(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
): Difference | null {
  if (typeof raw !== "string") {
    if (raw === null && stored === null) return null;
    if (stored === String(raw)) return null;
    return { column, raw, stored, explanation: null };
  }
  if (Object.is(raw, stored)) return null;
  const decoded = cellText(raw);
  const trimmed = decoded.trim();
  if (trimmed === "" && stored === null) {
    if (trimmed !== decoded) return { column, raw, stored, explanation: explanationForField(issues, "whitespace-trimmed", column) };
    return null;
  }
  const storedText = typeof stored === "string" ? stored : null;
  if (storedText === decoded && decoded !== raw) return { column, raw, stored, explanation: { rule: "entity-decoding" } };
  if (storedText === trimmed && trimmed !== decoded) {
    return { column, raw, stored, explanation: explanationForField(issues, "whitespace-trimmed", column) };
  }
  return { column, raw, stored, explanation: null };
}

/**
 * Entries are split, decoded and trimmed independently of the parser.
 * A dropped empty entry needs `empty-option-dropped`. Entity decoding is its own rule.
 * Any other matched list is the `option-list` rule: whitespace around commas, and trimming
 * of entries. Choice options on a non-checkbox answer need `options-orphan`, even when
 * the joined text matches.
 */
function optionDifference(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
  choiceColumn: boolean,
  answerType: Cell,
): Difference | null {
  if (raw === null) {
    if (stored === null) return null;
    return { column, raw, stored, explanation: null };
  }
  const text = typeof raw === "string" ? raw : String(raw);
  const normalised = normaliseOptionCell(text);
  const storedEntries = splitOptions(stored);
  if (!sameList(normalised.entries, storedEntries)) return { column, raw, stored, explanation: null };

  const orphan = choiceColumn && answerType !== "checkbox" && normalised.entries.length > 0;
  if (optionTextUnchanged(text, stored, normalised)) {
    return finishOption(column, raw, stored, { changed: false }, issues, orphan);
  }

  const explanation = optionChangeExplanation(column, issues, normalised);
  return finishOption(column, raw, stored, { changed: true, explanation }, issues, orphan);
}

function optionChangeExplanation(
  column: string,
  issues: readonly ImportIssue[],
  normalised: { droppedEmpty: boolean; decoded: boolean },
): DifferenceExplanation | null {
  if (normalised.droppedEmpty) return explanationForField(issues, "empty-option-dropped", column);
  if (normalised.decoded) return { rule: "entity-decoding" };
  return { rule: "option-list" };
}

function optionTextUnchanged(
  text: string,
  stored: Cell,
  normalised: { droppedEmpty: boolean; decoded: boolean },
): boolean {
  if (normalised.droppedEmpty || normalised.decoded) return false;
  if (text.trim() === "") return stored === null;
  return text === stored;
}

function finishOption(
  column: string,
  raw: Cell,
  stored: Cell,
  change: ValueChange,
  issues: readonly ImportIssue[],
  orphan: boolean,
): Difference | null {
  if (!orphan) {
    if (!change.changed) return null;
    return { column, raw, stored, explanation: change.explanation };
  }
  return withCheckIssue(column, raw, stored, change, issues, "options-orphan");
}

/**
 * No text change is explained by the Check issue alone.
 * A named rule stays the explanation, but the Check issue still has to be present.
 * An issue list gains the Check kind. A missing Check issue, or an unexplained text change, is unexplained.
 */
function withCheckIssue(
  column: string,
  raw: Cell,
  stored: Cell,
  change: ValueChange,
  issues: readonly ImportIssue[],
  kind: IssueKind,
): Difference {
  const check = explanationForKind(issues, kind);
  if (!change.changed) return { column, raw, stored, explanation: check };
  if (change.explanation === null || check === null) return { column, raw, stored, explanation: null };
  if ("issues" in change.explanation) {
    return { column, raw, stored, explanation: { issues: [...change.explanation.issues, kind] } };
  }
  return { column, raw, stored, explanation: change.explanation };
}

function normaliseOptionCell(raw: string): { entries: string[]; droppedEmpty: boolean; decoded: boolean } {
  if (raw.trim() === "") return { entries: [], droppedEmpty: false, decoded: false };
  let droppedEmpty = false;
  let decoded = false;
  const entries: string[] = [];
  for (const part of raw.split(",")) {
    const decodedPart = decodeHTML(part);
    if (decodedPart !== part) decoded = true;
    const trimmed = decodedPart.trim();
    if (trimmed === "") droppedEmpty = true;
    else entries.push(trimmed);
  }
  return { entries, droppedEmpty, decoded };
}

function splitOptions(value: Cell): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/**
 * A known value whose visible text changed needs `vocabulary-normalised`.
 * Unknown or blank needs the fallback issue, which replaces the re-case notice.
 * Decoding alone is the entity-decoding rule. A non-string cell's string form is not a difference.
 */
function vocabularyDifference(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
  allowed: readonly string[],
  fallback: string,
  fallbackKind: IssueKind,
): Difference | null {
  if (typeof stored !== "string") return { column, raw, stored, explanation: null };

  const decoded = cellText(raw);
  const canonical = decoded.trim().toLowerCase();
  if (!allowed.includes(canonical)) {
    if (stored !== fallback) return { column, raw, stored, explanation: null };
    return { column, raw, stored, explanation: explanationForKind(issues, fallbackKind) };
  }

  if (stored !== canonical) return { column, raw, stored, explanation: null };

  const normalised: Difference = {
    column,
    raw,
    stored,
    explanation: explanationForField(issues, "vocabulary-normalised", column),
  };
  if (typeof raw !== "string") {
    if (decoded === stored) return null;
    return normalised;
  }
  if (raw === stored) return null;
  if (decoded === stored) return { column, raw, stored, explanation: { rule: "entity-decoding" } };
  return normalised;
}

/**
 * On a defect, a missing or invalid Category is a difference only `category-missing` explains,
 * including a blank cell stored as null. On info or limit, a kept value is a difference only
 * `category-orphan` explains, even when the number matches. `"0"`, `0` and `0.0` are the same
 * Category and are not recorded. An invalid value on info or limit is dropped with no issue.
 */
function categoryDifference(
  column: string,
  raw: Cell,
  stored: Cell,
  issues: readonly ImportIssue[],
  commentType: Cell,
): Difference | null {
  const numeric = validCategory(categoryNumber(raw));
  if (commentType === "defect") {
    if (numeric !== null) {
      if (stored === numeric) return null;
      return { column, raw, stored, explanation: null };
    }
    if (stored === null) {
      return { column, raw, stored, explanation: explanationForKind(issues, "category-missing") };
    }
    return { column, raw, stored, explanation: null };
  }

  if (commentType === "info" || commentType === "limit") {
    if (numeric !== null) {
      if (stored !== numeric) return { column, raw, stored, explanation: null };
      return { column, raw, stored, explanation: explanationForKind(issues, "category-orphan") };
    }
    if (stored !== null) return { column, raw, stored, explanation: null };
    if (isBlankCategory(raw)) return null;
    return { column, raw, stored, explanation: { rule: "category-dropped" } };
  }

  return equalityDifference(column, raw, stored);
}

function categoryNumber(value: Cell): number | null {
  if (typeof value === "number") return value;
  const text = cellText(value).trim();
  if (text === "") return null;
  return Number(text);
}

function validCategory(numeric: number | null): -1 | 0 | 1 | null {
  if (numeric === -1 || numeric === 0 || numeric === 1) return numeric;
  return null;
}

function isBlankCategory(value: Cell): boolean {
  return value === null || (typeof value === "string" && cellText(value).trim() === "");
}

function cellForHeader(headers: readonly string[], cells: readonly Cell[], header: string): Cell {
  const index = columnIndex(headers, header);
  if (index < 0 || index >= cells.length) return null;
  return cells[index] ?? null;
}

function commentTextDifference(column: string, raw: Cell, stored: Cell, issues: readonly ImportIssue[]): Difference | null {
  const input = typeof raw === "string" ? raw : "";
  const storedText = typeof stored === "string" ? stored : "";
  const replayed = replay(input, issues);
  if (replayed === null || replayed !== storedText) return { column, raw, stored, explanation: null };
  if (storedText === input) return null;
  const kinds = issues.filter((issue) => issue.cuts.length > 0).map((issue) => issue.kind);
  if (kinds.length === 0) return { column, raw, stored, explanation: null };
  return { column, raw, stored, explanation: { issues: kinds } };
}

function nameDifference(column: string, raw: Cell, stored: Cell, issues: readonly ImportIssue[]): Difference | null {
  if (Object.is(raw, stored)) return null;

  const decoded = cellText(raw);
  const trimmed = decoded.trim();
  const storedText = typeof stored === "string" ? stored : null;
  const fallback = blankNameFallback(column);

  // "Untitled …" replaces a blank name, and only `blank-name` explains it. A trim notice does not.
  if (fallback !== null && trimmed === "") {
    if (storedText === fallback) {
      return { column, raw, stored, explanation: explanationForField(issues, "blank-name", column) };
    }
    return { column, raw, stored, explanation: null };
  }

  const decodedEntities = typeof raw === "string" && decoded !== raw;

  if (storedText === decoded && decodedEntities) {
    return { column, raw, stored, explanation: { rule: "entity-decoding" } };
  }

  const storedAsBlank = stored === null && trimmed === "";
  if ((storedText === trimmed || storedAsBlank) && trimmed !== decoded) {
    return { column, raw, stored, explanation: explanationForField(issues, "whitespace-trimmed", column) };
  }

  return { column, raw, stored, explanation: null };
}

/** Independent copy of the parser's blank-name fallback. Recommendation is not a name. */
function blankNameFallback(column: string): string | null {
  if (matchesExpectedHeader(column, SECTION_NAME)) return "Untitled Section";
  if (matchesExpectedHeader(column, ITEM_NAME)) return "Untitled Item";
  if (matchesExpectedHeader(column, COMMENT_NAME)) return "Untitled Comment";
  return null;
}

function normalisedStructureName(value: Cell, column: string): string {
  const trimmed = cellText(value).trim();
  if (trimmed !== "") return trimmed;
  return blankNameFallback(column) ?? "";
}

function equalityDifference(column: string, raw: Cell, stored: Cell): Difference | null {
  if (Object.is(raw, stored)) return null;
  return { column, raw, stored, explanation: null };
}

/** Cuts sorted by start. Null when they are out of range or overlapping, which the check cannot explain. */
function replay(input: string, issues: readonly ImportIssue[]): string | null {
  const cuts: Cut[] = issues.flatMap((issue) =>
    issue.cuts.map(
      (cut): Cut => ({
        start: cut.start,
        end: cut.end,
        kind: cut.kind,
        removedText: cut.removedText,
        replacement: cut.replacement ?? undefined,
        context: { tag: "" },
      }),
    ),
  );
  cuts.sort((left, right) => left.start - right.start || left.end - right.end);
  try {
    return applyCuts(input, cuts);
  } catch {
    return null;
  }
}

function flagSourceRowOrder(checked: readonly CheckedComment[]): void {
  let previous: number | null = null;
  for (const entry of checked) {
    const rowNumber = entry.comment.sourceRow;
    if (typeof rowNumber !== "number") continue;
    if (previous !== null && rowNumber <= previous) {
      entry.differences.push({ column: "Source row", raw: previous, stored: rowNumber, explanation: null });
    }
    previous = rowNumber;
  }
}

function flagBoundaries(checked: readonly CheckedComment[], headers: readonly string[]): void {
  const sectionIndex = columnIndex(headers, SECTION_NAME);
  const itemIndex = columnIndex(headers, ITEM_NAME);
  let previous: CheckedComment | null = null;
  for (const current of checked) {
    if (previous?.source && current.source) {
      const sourceSectionBreak =
        normalisedName(cellAt(previous.source, sectionIndex)) !== normalisedName(cellAt(current.source, sectionIndex));
      const treeSectionBreak = previous.section !== current.section;
      if (sourceSectionBreak !== treeSectionBreak) {
        current.differences.push(boundary("Section boundary", sourceSectionBreak, treeSectionBreak));
      }
      const sourceItemBreak =
        sourceSectionBreak ||
        normalisedName(cellAt(previous.source, itemIndex)) !== normalisedName(cellAt(current.source, itemIndex));
      const treeItemBreak = previous.item !== current.item;
      if (sourceItemBreak !== treeItemBreak) {
        current.differences.push(boundary("Item boundary", sourceItemBreak, treeItemBreak));
      }
    }
    if (current.source) previous = current;
  }
}

type RunSpan = { name: string; firstRow: number; lastRow: number };

/**
 * A Section or Item name that reappears after a different name is a split run.
 * Detected from Source rows, after the Untitled fallback, so it does not trust the parser.
 * The first row of the later run is unexplained unless it carries `split-run`.
 */
function flagSplitRuns(
  sourceRows: readonly SourceRow[],
  headers: readonly string[],
  issuesByRow: ReadonlyMap<number, readonly ImportIssue[]>,
  differencesByRow: Map<number, Difference[]>,
): void {
  const sectionIndex = columnIndex(headers, SECTION_NAME);
  const itemIndex = columnIndex(headers, ITEM_NAME);
  const named = sourceRows.map((row) => ({
    row: row.rowNumber,
    section: normalisedStructureName(cellAt(row, sectionIndex), SECTION_NAME),
    item: normalisedStructureName(cellAt(row, itemIndex), ITEM_NAME),
  }));

  const sectionRuns = spansOf(named.map((entry) => ({ row: entry.row, name: entry.section })));
  flagLaterRuns(sectionRuns, "section", issuesByRow, differencesByRow);
  for (const sectionRun of sectionRuns) {
    const items = named
      .filter((entry) => entry.row >= sectionRun.firstRow && entry.row <= sectionRun.lastRow)
      .map((entry) => ({ row: entry.row, name: entry.item }));
    flagLaterRuns(spansOf(items), "item", issuesByRow, differencesByRow);
  }
}

function spansOf(entries: readonly { row: number; name: string }[]): RunSpan[] {
  const runs: RunSpan[] = [];
  for (const entry of entries) {
    const last = runs[runs.length - 1];
    if (last && last.name === entry.name) last.lastRow = entry.row;
    else runs.push({ name: entry.name, firstRow: entry.row, lastRow: entry.row });
  }
  return runs;
}

function flagLaterRuns(
  runs: readonly RunSpan[],
  level: "section" | "item",
  issuesByRow: ReadonlyMap<number, readonly ImportIssue[]>,
  differencesByRow: Map<number, Difference[]>,
): void {
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (!run) continue;
    const repeated = runs.slice(0, index).some((earlier) => earlier.name === run.name);
    if (!repeated) continue;
    const explained = (issuesByRow.get(run.firstRow) ?? []).some((issue) => issue.kind === "split-run");
    differencesByRow.get(run.firstRow)?.push({
      column: "Split run",
      raw: level,
      stored: run.name,
      explanation: explained ? { issues: ["split-run"] } : null,
    });
  }
}

function boundary(column: string, sourceBreak: boolean, treeBreak: boolean): Difference {
  return {
    column,
    raw: sourceBreak ? "break" : "same",
    stored: treeBreak ? "break" : "same",
    explanation: null,
  };
}

function emptyStructure(tree: EditableTree): ReconcileRow[] {
  const rows: ReconcileRow[] = [];
  for (const section of tree.sections) {
    if (section.items.length === 0) {
      rows.push(toRow(null, [{ column: "Section", raw: null, stored: section.name, explanation: null }]));
    }
    for (const item of section.items) {
      if (item.comments.length === 0) {
        rows.push(toRow(null, [{ column: "Item", raw: null, stored: item.name, explanation: null }]));
      }
    }
  }
  return rows;
}

function toRow(sourceRow: number | null, differences: Difference[]): ReconcileRow {
  const unexplained = differences.some((difference) => difference.explanation === null);
  return { sourceRow, status: unexplained ? "✗" : "✓", differences };
}

function tally(rows: readonly ReconcileRow[]): Pick<ReconcileResult, "verified" | "total" | "explained" | "unexplained"> {
  let explained = 0;
  let unexplained = 0;
  for (const row of rows) {
    for (const difference of row.differences) {
      if (difference.explanation === null) unexplained += 1;
      else explained += 1;
    }
  }
  return { verified: rows.filter((row) => row.status === "✓").length, total: rows.length, explained, unexplained };
}

function cellText(value: Cell): string {
  if (typeof value === "string") return decodeHTML(value);
  if (value === null) return "";
  return String(value);
}

function normalisedName(value: Cell): string {
  return cellText(value).trim();
}

function fieldOf(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || !("field" in detail)) return null;
  return typeof detail.field === "string" ? detail.field : null;
}

function explanationForKind(issues: readonly ImportIssue[], kind: IssueKind): DifferenceExplanation | null {
  return issues.some((issue) => issue.kind === kind) ? { issues: [kind] } : null;
}

/** A field issue explains the difference only when its detail names this column. */
function explanationForField(
  issues: readonly ImportIssue[],
  kind: IssueKind,
  column: string,
): DifferenceExplanation | null {
  const explained = issues.some(
    (issue) => issue.kind === kind && matchesExpectedHeader(column, fieldOf(issue.detail) ?? ""),
  );
  return explained ? { issues: [kind] } : null;
}

function cellAt(row: SourceRow, index: number): Cell {
  if (index < 0 || index >= row.cells.length) return null;
  return row.cells[index] ?? null;
}

function columnIndex(headers: readonly string[], header: string): number {
  return headers.findIndex((cell) => matchesExpectedHeader(cell, header));
}

function matchesAny(header: string, expected: readonly string[]): boolean {
  return expected.some((candidate) => matchesExpectedHeader(header, candidate));
}

/**
 * Own copy of the parser's header rule, so reconcile does not call the parser.
 * A file header matches Spectora's verbatim header, or that header without its parenthetical hint.
 */
function matchesExpectedHeader(fileHeader: string, expected: string): boolean {
  const file = fileHeader.trim().toLowerCase();
  return file === expected.trim().toLowerCase() || file === withoutHint(expected);
}

function withoutHint(header: string): string {
  return header.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function copyCells(cells: readonly Cell[], width: number): Cell[] {
  const copy = blankCells(width);
  for (let index = 0; index < Math.min(width, cells.length); index += 1) copy[index] = cells[index] ?? null;
  return copy;
}

function blankCells(width: number): Cell[] {
  return Array.from({ length: width }, () => null);
}
