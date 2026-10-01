import { sanitiseCommentHtml, type Cut, type CutKind } from "@/core/sanitise";
import type { Comment, EditableTree } from "@/core/import/schemas";

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
 * The tree Save stores. Strips ids, trims as the parser does (U+00A0 included),
 * drops empty option entries, and re-sanitises every Comment. Blank names are the only refusal.
 */
export function prepareSave(tree: EditableTree): PrepareSaveResult {
  const blank: BlankName[] = [];
  const changes: TextChange[] = [];
  const sections = tree.sections.map((section, sectionIndex) => {
    const name = section.name.trim();
    if (name === "") blank.push({ level: "section", path: [sectionIndex] });
    return {
      name,
      items: section.items.map((item, itemIndex) => {
        const itemName = item.name.trim();
        if (itemName === "") blank.push({ level: "item", path: [sectionIndex, itemIndex] });
        return {
          name: itemName,
          comments: item.comments.map((entry, commentIndex) =>
            prepareComment(entry, [sectionIndex, itemIndex, commentIndex], blank, changes),
          ),
        };
      }),
    };
  });
  if (blank.length > 0) return { ok: false, blank };
  return { ok: true, tree: { sections }, changes };
}

function prepareComment(
  comment: Comment,
  path: [number, number, number],
  blank: BlankName[],
  changes: TextChange[],
): Comment {
  const name = comment.name.trim();
  if (name === "") blank.push({ level: "comment", path });
  const text = sanitiseCommentHtml(comment.textHtml);
  if (text.cuts.length > 0) {
    changes.push({
      path,
      name,
      sourceRow: comment.sourceRow,
      cuts: text.cuts,
      summary: summariseCuts(text.cuts),
    });
  }
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

/** Blank after trimming becomes null, matching an empty Recommendation or free-text default on import. */
function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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
      return count === 1
        ? `1 tag removed with its content: ${quoted(tagsOf(cuts))}`
        : `${count} tags removed with their content: ${quoted(tagsOf(cuts))}`;
    case "attribute-removed":
      return count === 1
        ? `1 attribute removed: ${quoted(attributesOf(cuts))}`
        : `${count} attributes removed: ${quoted(attributesOf(cuts))}`;
    case "editor-leftover":
      return count === 1
        ? `1 editor leftover removed: ${quoted(attributesOf(cuts))}`
        : `${count} editor leftovers removed: ${quoted(attributesOf(cuts))}`;
    case "css-property-removed":
      return count === 1
        ? `1 style property removed: ${quoted(propertiesOf(cuts))}`
        : `${count} style properties removed: ${quoted(propertiesOf(cuts))}`;
    case "style-unparseable":
      return count === 1
        ? `1 unparseable style removed: ${quoted(tagsOf(cuts))}`
        : `${count} unparseable styles removed: ${quoted(tagsOf(cuts))}`;
    case "tag-unwrapped":
      return count === 1 ? `1 tag unwrapped: ${quoted(tagsOf(cuts))}` : `${count} tags unwrapped: ${quoted(tagsOf(cuts))}`;
    case "link-scheme-removed":
      return count === 1
        ? "1 link address removed (unsafe scheme)"
        : `${count} link addresses removed (unsafe scheme)`;
    case "iframe-to-link":
      return count === 1 ? "1 iframe turned into a link" : `${count} iframes turned into links`;
    case "youtube-wrapper-emptied":
      return count === 1 ? "1 empty YouTube wrapper removed" : `${count} empty YouTube wrappers removed`;
    case "markup-rebuilt":
      return "Markup rebuilt";
    default: {
      const unreachable: never = kind;
      throw new Error(`Unknown cut kind: ${String(unreachable)}`);
    }
  }
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
