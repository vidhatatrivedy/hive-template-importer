import type { SaveError } from "@/core/import/editor-messages";
import { prepareSave } from "@/core/import/prepare-save";
import type { Comment, EditableTree, Item, Section } from "@/core/import/schemas";

/** The column the inspector is working in. Columns to its left collapse. */
export type Column = "sections" | "items" | "comments";

export type NodeRef = { level: "section" | "item" | "comment"; id: string };

export type EditorSelection = {
  sectionId: string | null;
  itemId: string | null;
  commentId: string | null;
};

/** The Version the editor was opened or last adopted against. */
export type EditorBase = {
  versionId: string;
  number: number;
  tree: EditableTree;
};

/** Where a Save is. `invalid` and `confirm` arrive with later tickets. */
export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "awaiting"; number: number }
  | { status: "refused"; error: SaveError };

export type EditorMode = "edit" | "read-only";

export type EditorState = {
  mode: EditorMode;
  base: EditorBase;
  tree: EditableTree;
  selection: EditorSelection;
  focus: Column;
  /** Set when `?row=` names no Comment. Cleared by the next selection. */
  rowMiss: number | null;
  save: SaveState;
  /** A Version that arrived while a Save was in flight. Adopted when that Save succeeds, or on Discard. */
  held: EditorBase | null;
};

/** Fields a Comment can be edited through. Ids, Source rows and unit options stay put. */
export type CommentPatch = Partial<Omit<Comment, "id" | "sourceRow" | "unitOptions">>;

export type EditorAction =
  | ({ type: "serverVersion" } & EditorBase)
  | { type: "select"; ref: NodeRef }
  | { type: "focus"; column: Column }
  | { type: "selectRow"; row: number }
  | { type: "setComment"; id: string; patch: CommentPatch }
  | { type: "saveRequested" }
  | { type: "saveSucceeded"; number: number }
  | { type: "saveFailed"; error: SaveError }
  | { type: "dismissError" }
  | { type: "discard" };

const COMMENT_GROUPS = [
  { type: "info", label: "Informational" },
  { type: "limit", label: "Limitations" },
  { type: "defect", label: "Deficiencies" },
] as const;

/** Comments grouped Informational, then Limitations, then Deficiencies, each group in stored order. */
export function commentGroups(comments: readonly Comment[]): { label: string; comments: Comment[] }[] {
  return COMMENT_GROUPS.map((group) => ({
    label: group.label,
    comments: comments.filter((comment) => comment.commentType === group.type),
  })).filter((group) => group.comments.length > 0);
}

export function locate(
  tree: EditableTree,
  selection: EditorSelection,
): { section: Section | null; item: Item | null; comment: Comment | null } {
  const section = tree.sections.find((candidate) => candidate.id === selection.sectionId) ?? null;
  const item = section?.items.find((candidate) => candidate.id === selection.itemId) ?? null;
  const comment = item?.comments.find((candidate) => candidate.id === selection.commentId) ?? null;
  return { section, item, comment };
}

export function initialEditorState(
  input: EditorBase & { row: number | null; mode?: EditorMode },
): EditorState {
  const { row, mode = "edit", ...base } = input;
  const state: EditorState = {
    mode,
    base,
    tree: base.tree,
    selection: emptySelection(),
    focus: "sections",
    rowMiss: null,
    save: { status: "idle" },
    held: null,
  };
  if (row !== null) return editorReducer(state, { type: "selectRow", row });
  return selectFirst(state);
}

/** True when the working tree differs from the saved Version by value, ids included. */
export function isDirty(state: EditorState): boolean {
  return !sameTree(state.tree, state.base.tree);
}

export function isSavingOrAwaiting(state: EditorState): boolean {
  return state.save.status === "saving" || state.save.status === "awaiting";
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "serverVersion":
      return adoptVersion(state, action);
    case "select":
      return select(state, action.ref);
    case "focus":
      return state.focus === action.column ? state : { ...state, focus: action.column };
    case "selectRow":
      return selectRow(state, action.row);
    case "setComment":
      return setComment(state, action.id, action.patch);
    case "saveRequested":
      return requestSave(state);
    case "saveSucceeded":
      return saveSucceeded(state, action.number);
    case "saveFailed":
      return saveFailed(state, action.error);
    case "dismissError":
      return dismissError(state);
    case "discard":
      return discard(state);
    default: {
      const unreachable: never = action;
      throw new Error(`Unknown editor action: ${String(unreachable)}`);
    }
  }
}

function requestSave(state: EditorState): EditorState {
  if (state.mode === "read-only") return state;
  if (isSavingOrAwaiting(state)) return state;
  if (!isDirty(state)) return state;
  // Blank names and text cuts stay on this path until later tickets add `invalid` and `confirm`.
  prepareSave(state.tree);
  return { ...state, save: { status: "saving" } };
}

function saveSucceeded(state: EditorState, number: number): EditorState {
  if (state.save.status !== "saving") return state;
  const awaiting: EditorState = { ...state, save: { status: "awaiting", number } };
  const held = state.held;
  if (held && held.number >= number) return commitVersion(awaiting, held, { status: "idle" });
  return awaiting;
}

function saveFailed(state: EditorState, error: SaveError): EditorState {
  if (state.save.status !== "saving") return state;
  return { ...state, save: { status: "refused", error }, held: null };
}

function dismissError(state: EditorState): EditorState {
  if (state.save.status !== "refused") return state;
  return { ...state, save: { status: "idle" } };
}

/**
 * Back to the saved Version, or to a Version that arrived while Save was in flight.
 * The selection stays the node at the same place in the tree.
 */
function discard(state: EditorState): EditorState {
  if (state.mode === "read-only") return state;
  const nextBase = state.held ?? state.base;
  const path = indexPath(state.tree, state.selection);
  return {
    ...state,
    base: nextBase,
    tree: nextBase.tree,
    selection: path ? selectionAt(nextBase.tree, path) : emptySelection(),
    rowMiss: null,
    save: { status: "idle" },
    held: null,
  };
}

function setComment(state: EditorState, id: string, patch: CommentPatch): EditorState {
  if (state.mode === "read-only") return state;
  if (state.save.status === "saving") return state;
  for (let sectionIndex = 0; sectionIndex < state.tree.sections.length; sectionIndex++) {
    const section = state.tree.sections[sectionIndex];
    if (!section) continue;
    for (let itemIndex = 0; itemIndex < section.items.length; itemIndex++) {
      const item = section.items[itemIndex];
      if (!item) continue;
      const commentIndex = item.comments.findIndex((comment) => comment.id === id);
      const current = item.comments[commentIndex];
      if (!current) continue;
      const next = applyCommentPatch(current, patch);
      if (sameComment(current, next)) return state;
      const comments = item.comments.slice();
      comments[commentIndex] = next;
      const items = section.items.slice();
      items[itemIndex] = { ...item, comments };
      const sections = state.tree.sections.slice();
      sections[sectionIndex] = { ...section, items };
      return { ...state, tree: { sections } };
    }
  }
  return state;
}

function applyCommentPatch(comment: Comment, patch: CommentPatch): Comment {
  const next = { ...comment };
  for (const key of Object.keys(patch) as (keyof CommentPatch)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    Object.assign(next, { [key]: value });
  }
  return next;
}

function sameTree(a: EditableTree, b: EditableTree): boolean {
  if (a === b) return true;
  return sameList(a.sections, b.sections, sameSection);
}

function sameSection(a: Section, b: Section): boolean {
  if (a === b) return true;
  return a.id === b.id && a.name === b.name && sameList(a.items, b.items, sameItem);
}

function sameItem(a: Item, b: Item): boolean {
  if (a === b) return true;
  return a.id === b.id && a.name === b.name && sameList(a.comments, b.comments, sameComment);
}

function sameComment(a: Comment, b: Comment): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.sourceRow === b.sourceRow &&
    a.name === b.name &&
    a.textHtml === b.textHtml &&
    a.commentType === b.commentType &&
    a.category === b.category &&
    a.recommendation === b.recommendation &&
    a.answerType === b.answerType &&
    a.defaultBoolean === b.defaultBoolean &&
    a.defaultText === b.defaultText &&
    sameStrings(a.choiceOptions, b.choiceOptions) &&
    sameStrings(a.unitOptions, b.unitOptions)
  );
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (left: T, right: T) => boolean): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return other !== undefined && same(item, other);
  });
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function emptySelection(): EditorSelection {
  return { sectionId: null, itemId: null, commentId: null };
}

function focused(state: EditorState, focus: Column, selection: EditorSelection): EditorState {
  return { ...state, focus, rowMiss: null, selection };
}

function selectFirst(state: EditorState): EditorState {
  const section = state.tree.sections[0];
  const sectionId = nodeId(section);
  if (!section || !sectionId) return state;
  return { ...state, selection: selectionInSection(sectionId, section) };
}

function adoptVersion(state: EditorState, next: EditorBase): EditorState {
  switch (state.save.status) {
    case "saving":
      return { ...state, held: copyBase(next) };
    case "awaiting":
      if (next.number < state.save.number) return state;
      return commitVersion(state, next, { status: "idle" });
    case "idle":
    case "refused":
      return commitVersion(state, next, state.save);
    default: {
      const unreachable: never = state.save;
      throw new Error(`Unknown save status: ${String(unreachable)}`);
    }
  }
}

function commitVersion(state: EditorState, next: EditorBase, save: SaveState): EditorState {
  const path = indexPath(state.tree, state.selection);
  const base = copyBase(next);
  return {
    ...state,
    base,
    tree: base.tree,
    selection: path ? selectionAt(base.tree, path) : emptySelection(),
    save,
    held: null,
  };
}

/** Drops action fields such as `type` so a held or adopted Version is only its identity and tree. */
function copyBase(next: EditorBase): EditorBase {
  return { versionId: next.versionId, number: next.number, tree: next.tree };
}

function select(state: EditorState, ref: NodeRef): EditorState {
  if (ref.level === "section") return selectSection(state, ref.id);
  if (ref.level === "item") return selectItem(state, ref.id);
  return selectComment(state, ref.id);
}

function selectSection(state: EditorState, id: string): EditorState {
  const section = state.tree.sections.find((candidate) => candidate.id === id);
  if (!section) return state;
  return focused(state, "items", selectionInSection(id, section));
}

function selectItem(state: EditorState, id: string): EditorState {
  const placed = findItem(state.tree, id);
  if (!placed) return state;
  return focused(state, "comments", {
    sectionId: placed.sectionId,
    itemId: id,
    commentId: nodeId(firstDisplayed(placed.item.comments)),
  });
}

function selectComment(state: EditorState, id: string): EditorState {
  const placed = findComment(state.tree, (comment) => comment.id === id);
  if (!placed) return state;
  return focused(state, "comments", {
    sectionId: placed.sectionId,
    itemId: placed.itemId,
    commentId: id,
  });
}

function selectRow(state: EditorState, row: number): EditorState {
  const placed = findComment(state.tree, (comment) => Boolean(nodeId(comment)) && comment.sourceRow === row);
  const commentId = placed ? nodeId(placed.comment) : null;
  if (!placed || !commentId) return state.rowMiss === row ? state : { ...state, rowMiss: row };
  return focused(state, "comments", {
    sectionId: placed.sectionId,
    itemId: placed.itemId,
    commentId,
  });
}

/** The Section, its first Item, and that Item's first Comment in display order. */
function selectionInSection(sectionId: string, section: Section): EditorSelection {
  const item = section.items[0] ?? null;
  const comment = item ? firstDisplayed(item.comments) : null;
  return { sectionId, itemId: nodeId(item), commentId: nodeId(comment) };
}

function findItem(tree: EditableTree, id: string): { sectionId: string; item: Item } | null {
  for (const section of tree.sections) {
    const sectionId = nodeId(section);
    if (!sectionId) continue;
    const item = section.items.find((candidate) => candidate.id === id);
    if (!item) continue;
    return { sectionId, item };
  }
  return null;
}

function findComment(
  tree: EditableTree,
  matches: (comment: Comment) => boolean,
): { sectionId: string; itemId: string; comment: Comment } | null {
  for (const section of tree.sections) {
    const sectionId = nodeId(section);
    if (!sectionId) continue;
    for (const item of section.items) {
      const itemId = nodeId(item);
      if (!itemId) continue;
      const comment = item.comments.find(matches);
      if (!comment) continue;
      return { sectionId, itemId, comment };
    }
  }
  return null;
}

type IndexPath = { section: number; item: number | null; comment: number | null };

function indexPath(tree: EditableTree, selection: EditorSelection): IndexPath | null {
  const sectionIndex = tree.sections.findIndex((candidate) => candidate.id === selection.sectionId);
  if (sectionIndex < 0) return null;
  if (selection.itemId === null) return { section: sectionIndex, item: null, comment: null };

  const items = tree.sections[sectionIndex]?.items ?? [];
  const itemIndex = items.findIndex((candidate) => candidate.id === selection.itemId);
  if (itemIndex < 0) return { section: sectionIndex, item: null, comment: null };
  if (selection.commentId === null) return { section: sectionIndex, item: itemIndex, comment: null };

  const commentIndex =
    items[itemIndex]?.comments.findIndex((candidate) => candidate.id === selection.commentId) ?? -1;
  if (commentIndex < 0) return { section: sectionIndex, item: itemIndex, comment: null };
  return { section: sectionIndex, item: itemIndex, comment: commentIndex };
}

function selectionAt(tree: EditableTree, path: IndexPath): EditorSelection {
  if (tree.sections.length === 0) return emptySelection();
  const section = tree.sections[clamp(path.section, 0, tree.sections.length - 1)];
  const sectionId = nodeId(section);
  if (!section || !sectionId || path.item === null || section.items.length === 0) {
    return { sectionId, itemId: null, commentId: null };
  }
  const item = section.items[clamp(path.item, 0, section.items.length - 1)];
  const itemId = nodeId(item);
  if (!item || !itemId || path.comment === null || item.comments.length === 0) {
    return { sectionId, itemId, commentId: null };
  }
  const comment = item.comments[clamp(path.comment, 0, item.comments.length - 1)];
  return { sectionId, itemId, commentId: nodeId(comment) };
}

function firstDisplayed(comments: readonly Comment[]): Comment | null {
  return commentGroups(comments)[0]?.comments[0] ?? null;
}

function nodeId(node: { id?: string } | null | undefined): string | null {
  return node?.id ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
