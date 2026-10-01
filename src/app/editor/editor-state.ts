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

export type EditorState = {
  base: EditorBase;
  tree: EditableTree;
  selection: EditorSelection;
  focus: Column;
  /** Set when `?row=` names no Comment. Cleared by the next selection. */
  rowMiss: number | null;
};

export type EditorAction =
  | ({ type: "serverVersion" } & EditorBase)
  | { type: "select"; ref: NodeRef }
  | { type: "focus"; column: Column }
  | { type: "selectRow"; row: number };

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

export function initialEditorState(input: EditorBase & { row: number | null }): EditorState {
  const { row, ...base } = input;
  const state: EditorState = {
    base,
    tree: base.tree,
    selection: emptySelection(),
    focus: "sections",
    rowMiss: null,
  };
  if (row !== null) return editorReducer(state, { type: "selectRow", row });
  return selectFirst(state);
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
    default: {
      const unreachable: never = action;
      throw new Error(`Unknown editor action: ${String(unreachable)}`);
    }
  }
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
  const path = indexPath(state.tree, state.selection);
  const base = { versionId: next.versionId, number: next.number, tree: next.tree };
  return {
    ...state,
    base,
    tree: next.tree,
    selection: path ? selectionAt(next.tree, path) : emptySelection(),
  };
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
