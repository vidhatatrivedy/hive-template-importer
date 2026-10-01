import { sanitiseCommentHtml, type Cut, type CutKind } from "@/core/sanitise";
import type { Comment, EditableTree, Item, Section } from "@/core/import/schemas";

/** A name that is empty after trimming. `path` is the index path from the root. */
export type BlankName = {
  level: "section" | "item" | "comment";
  path: number[];
};

/** One Comment whose text Save would change. `summary` is what the pre-Save notice shows. */
export type TextChange = {
  path: [number, number, number];
  name: string;
  sourceRow: number | null;
  cuts: Cut[];
  summary: string[];
};

export type PrepareSaveResult =
  | { ok: true; tree: EditableTree; changes: TextChange[] }
  | { ok: false; blank: BlankName[] };

/**
 * Cuts Save would report, sanitising only Comments whose text differs from `base` (matched by id).
 * Imported text is already sanitised, so this matches `prepareSave`'s `changes` without sanitising every Comment.
 */
export function textChanges(tree: EditableTree, base: EditableTree): TextChange[] {
  const stored = textHtmlById(base);
  const changes: TextChange[] = [];
  for (const [sectionIndex, section] of tree.sections.entries()) {
    for (const [itemIndex, item] of section.items.entries()) {
      for (const [commentIndex, comment] of item.comments.entries()) {
        const previous = comment.id !== undefined ? stored.get(comment.id) : undefined;
        if (previous === comment.textHtml) continue;
        const change = textChangeIfCut(
          [sectionIndex, itemIndex, commentIndex],
          comment.name,
          comment.sourceRow,
          sanitiseCommentHtml(comment.textHtml),
        );
        if (change) changes.push(change);
      }
    }
  }
  return changes;
}

function textHtmlById(tree: EditableTree): Map<string, string> {
  const stored = new Map<string, string>();
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        if (comment.id !== undefined) stored.set(comment.id, comment.textHtml);
      }
    }
  }
  return stored;
}

/** A TextChange when `text` has cuts. The name is trimmed the same way Save stores it. */
function textChangeIfCut(
  path: [number, number, number],
  name: string,
  sourceRow: number | null,
  text: { cuts: Cut[] },
): TextChange | undefined {
  if (text.cuts.length === 0) return undefined;
  return {
    path,
    name: name.trim(),
    sourceRow,
    cuts: text.cuts,
    summary: summariseCuts(text.cuts),
  };
}

/**
 * The tree Save stores. Strips ids, trims as the parser does (U+00A0 included),
 * drops empty option entries, and re-sanitises every Comment. Blank names are the only refusal.
 */
export function prepareSave(tree: EditableTree): PrepareSaveResult {
  const blank: BlankName[] = [];
  const changes: TextChange[] = [];
  const sections = tree.sections.map((section, sectionIndex) =>
    prepareSection(section, sectionIndex, blank, changes),
  );
  if (blank.length > 0) return { ok: false, blank };
  return { ok: true, tree: { sections }, changes };
}

function prepareSection(section: Section, sectionIndex: number, blank: BlankName[], changes: TextChange[]): Section {
  return {
    name: trimmedName(section.name, "section", [sectionIndex], blank),
    items: section.items.map((item, itemIndex) => prepareItem(item, sectionIndex, itemIndex, blank, changes)),
  };
}

function prepareItem(
  item: Item,
  sectionIndex: number,
  itemIndex: number,
  blank: BlankName[],
  changes: TextChange[],
): Item {
  return {
    name: trimmedName(item.name, "item", [sectionIndex, itemIndex], blank),
    comments: item.comments.map((comment, commentIndex) =>
      prepareComment(comment, [sectionIndex, itemIndex, commentIndex], blank, changes),
    ),
  };
}

function prepareComment(
  comment: Comment,
  path: [number, number, number],
  blank: BlankName[],
  changes: TextChange[],
): Comment {
  const name = trimmedName(comment.name, "comment", path, blank);
  const text = sanitiseCommentHtml(comment.textHtml);
  const change = textChangeIfCut(path, name, comment.sourceRow, text);
  if (change) changes.push(change);
  return {
    sourceRow: comment.sourceRow,
    name,
    textHtml: text.html,
    commentType: comment.commentType,
    category: comment.category,
    recommendation: emptyToNull(comment.recommendation),
    defaultText: emptyToNull(comment.defaultText),
    answerType: comment.answerType,
    defaultBoolean: comment.defaultBoolean,
    choiceOptions: keptEntries(comment.choiceOptions),
    unitOptions: keptEntries(comment.unitOptions),
  };
}

/** Trimmed name. An empty result is recorded in `blank` with its level and index path. */
function trimmedName(raw: string, level: BlankName["level"], path: number[], blank: BlankName[]): string {
  const name = raw.trim();
  if (name === "") blank.push({ level, path });
  return name;
}

/** Blank after trimming becomes null, matching an empty Recommendation or free-text default on import. */
function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed;
}

function keptEntries(entries: readonly string[]): string[] {
  const kept: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed !== "") kept.push(trimmed);
  }
  return kept;
}

/** Short lines for a cut list, one per kind, in the order the kinds first appear. */
export function summariseCuts(cuts: readonly Cut[]): string[] {
  const groups = new Map<CutKind, Cut[]>();
  for (const cut of cuts) {
    const group = groups.get(cut.kind);
    if (group) group.push(cut);
    else groups.set(cut.kind, [cut]);
  }
  return [...groups.entries()].map(([kind, group]) => lineFor(kind, group));
}

function lineFor(kind: CutKind, cuts: readonly Cut[]): string {
  const count = cuts.length;
  switch (kind) {
    case "tag-removed":
      return summaryLine(count, "tag removed with its content", "tags removed with their content", quoted(tagsOf(cuts)));
    case "attribute-removed":
      return summaryLine(count, "attribute removed", "attributes removed", quoted(attributesOf(cuts)));
    case "editor-leftover":
      return summaryLine(count, "editor leftover removed", "editor leftovers removed", quoted(attributesOf(cuts)));
    case "css-property-removed":
      return summaryLine(count, "style property removed", "style properties removed", quoted(propertiesOf(cuts)));
    case "style-unparseable":
      return summaryLine(count, "unparseable style removed", "unparseable styles removed", quoted(tagsOf(cuts)));
    case "tag-unwrapped":
      return summaryLine(count, "tag unwrapped", "tags unwrapped", quoted(tagsOf(cuts)));
    case "link-scheme-removed":
      return summaryLine(count, "link address removed (unsafe scheme)", "link addresses removed (unsafe scheme)");
    case "iframe-to-link":
      return summaryLine(count, "iframe turned into a link", "iframes turned into links");
    case "youtube-wrapper-emptied":
      return summaryLine(count, "empty YouTube wrapper removed", "empty YouTube wrappers removed");
    case "markup-rebuilt":
      return "Markup rebuilt";
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown cut kind: ${String(unreachable)}`);
    }
  }
}

function summaryLine(count: number, singular: string, plural: string, detail?: string): string {
  const phrase = `${count} ${count === 1 ? singular : plural}`;
  if (detail === undefined) return phrase;
  return `${phrase}: ${detail}`;
}

function tagsOf(cuts: readonly Cut[]): string[] {
  return unique(cuts.map((cut) => cut.context.tag)).map((tag) => `<${tag}>`);
}

function attributesOf(cuts: readonly Cut[]): string[] {
  return unique(cuts.map((cut) => cut.context.attribute));
}

function propertiesOf(cuts: readonly Cut[]): string[] {
  return unique(cuts.map((cut) => cut.context.property));
}

function unique(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function quoted(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}
