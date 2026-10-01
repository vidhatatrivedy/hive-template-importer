import type { Comment, EditableTree } from "@/core/import/schemas";

/** The column the inspector is working in. Columns to its left collapse. */
export type Column = "sections" | "items" | "comments";

export type NodeRef = { level: "section" | "item" | "comment"; id: string };

export type EditorSelection = {
  sectionId: string | null;
  itemId: string | null;
  commentId: string | null;
};

export type EditorState = {
  base: { versionId: string; number: number; tree: EditableTree };
  tree: EditableTree;
  selection: EditorSelection;
  focus: Column;
  /** Set when `?row=` names no Comment. Cleared by the next selection. */
  rowMiss: number | null;
};

export type EditorAction =
  | { type: "serverVersion"; versionId: string; number: number; tree: EditableTree }
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

export function initialEditorState(input: {
  versionId: string;
  number: number;
  tree: EditableTree;
  row: number | null;
}): EditorState {
  const state: EditorState = {
    base: { versionId: input.versionId, number: input.number, tree: input.tree },
    tree: input.tree,
    selection: { sectionId: null, itemId: null, commentId: null },
    focus: "sections",
    rowMiss: null,
  };
  if (input.row !== null) return editorReducer(state, { type: "selectRow", row: input.row });
  return selectFirst(state);
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "serverVersion":
      return adopt(state, action.versionId, action.number, action.tree);
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

function selectFirst(state: EditorState): EditorState {
  const section = state.tree.sections[0];
  const sectionId = nodeId(section);
  if (!section || !sectionId) return state;
  const item = section.items[0] ?? null;
  const comment = item ? firstDisplayed(item.comments) : null;
  return {
    ...state,
    selection: { sectionId, itemId: nodeId(item), commentId: nodeId(comment) },
  };
}

function adopt(state: EditorState, versionId: string, number: number, tree: EditableTree): EditorState {
  const path = indexPath(state.tree, state.selection);
  return {
    ...state,
    base: { versionId, number, tree },
    tree,
    selection: path ? selectionAt(tree, path) : { sectionId: null, itemId: null, commentId: null },
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
  const item = section.items[0] ?? null;
  const comment = item ? firstDisplayed(item.comments) : null;
  return {
    ...state,
    focus: "items",
    rowMiss: null,
    selection: { sectionId: id, itemId: nodeId(item), commentId: nodeId(comment) },
  };
}

function selectItem(state: EditorState, id: string): EditorState {
  for (const section of state.tree.sections) {
    const sectionId = nodeId(section);
    const item = section.items.find((candidate) => candidate.id === id);
    if (!sectionId || !item) continue;
    const comment = firstDisplayed(item.comments);
    return {
      ...state,
      focus: "comments",
      rowMiss: null,
      selection: { sectionId, itemId: id, commentId: nodeId(comment) },
    };
  }
  return state;
}

function selectComment(state: EditorState, id: string): EditorState {
  for (const section of state.tree.sections) {
    const sectionId = nodeId(section);
    if (!sectionId) continue;
    for (const item of section.items) {
      const itemId = nodeId(item);
      if (!itemId || !item.comments.some((candidate) => candidate.id === id)) continue;
      return {
        ...state,
        focus: "comments",
        rowMiss: null,
        selection: { sectionId, itemId, commentId: id },
      };
    }
  }
  return state;
}

function selectRow(state: EditorState, row: number): EditorState {
  for (const section of state.tree.sections) {
    const sectionId = nodeId(section);
    if (!sectionId) continue;
    for (const item of section.items) {
      const itemId = nodeId(item);
      if (!itemId) continue;
      for (const comment of item.comments) {
        const commentId = nodeId(comment);
        if (!commentId || comment.sourceRow !== row) continue;
        return {
          ...state,
          focus: "comments",
          rowMiss: null,
          selection: { sectionId, itemId, commentId },
        };
      }
    }
  }
  return state.rowMiss === row ? state : { ...state, rowMiss: row };
}

type IndexPath = { section: number; item: number | null; comment: number | null };

function indexPath(tree: EditableTree, selection: EditorSelection): IndexPath | null {
  const section = tree.sections.findIndex((candidate) => candidate.id === selection.sectionId);
  if (section < 0) return null;
  if (selection.itemId === null) return { section, item: null, comment: null };
  const items = tree.sections[section]?.items ?? [];
  const item = items.findIndex((candidate) => candidate.id === selection.itemId);
  if (item < 0) return { section, item: null, comment: null };
  if (selection.commentId === null) return { section, item, comment: null };
  const comment = items[item]?.comments.findIndex((candidate) => candidate.id === selection.commentId) ?? -1;
  if (comment < 0) return { section, item, comment: null };
  return { section, item, comment };
}

function selectionAt(tree: EditableTree, path: IndexPath): EditorSelection {
  if (tree.sections.length === 0) return { sectionId: null, itemId: null, commentId: null };
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
