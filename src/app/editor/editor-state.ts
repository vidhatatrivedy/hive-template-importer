import type { SaveError } from "@/core/import/editor-messages";
import { prepareSave } from "@/core/import/prepare-save";
import type { Comment, EditableTree, Item, Section } from "@/core/import/schemas";

/** The column the inspector is working in. Columns to its left collapse. */
export type Column = "sections" | "items" | "comments";

export type NodeRef = { level: "section" | "item" | "comment"; id: string };

export type Direction = "up" | "down";

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

/** Where a Save is. `confirm` arrives with a later ticket. */
export type SaveState =
  | { status: "idle" }
  /** A Save was attempted with blank names. The markers come from `blankNames`, so they clear as names are filled. */
  | { status: "invalid" }
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
  /** The node whose name field takes focus: the first blank name after a refused Save. Cleared by `nameFocused`. */
  focusName: string | null;
  save: SaveState;
  /**
   * A Version that arrived while there were unsaved edits or a Save was in flight. Never replaces the edits:
   * adopted when that Save succeeds, on Load latest, or on Discard.
   */
  held: EditorBase | null;
  /** The number in the next added node's `tmp-` id. Never reused, so a new node can't take an old one's id. */
  nextTmp: number;
  /** Set when a checkbox default pointed at an option that was removed. Cleared on Discard. */
  note: { commentId: string; kind: "default-cleared" } | null;
};

/** Fields a Comment can be edited through. Ids, Source rows and unit options stay put. */
export type CommentPatch = Partial<Omit<Comment, "id" | "sourceRow" | "unitOptions">>;

export type EditorAction =
  | ({ type: "serverVersion" } & EditorBase)
  | { type: "select"; ref: NodeRef }
  | { type: "focus"; column: Column }
  | { type: "selectRow"; row: number }
  | { type: "addSection" }
  | { type: "addItem" }
  | { type: "addComment"; commentType: Comment["commentType"] }
  | { type: "delete"; ref: NodeRef }
  | { type: "move"; ref: NodeRef; dir: Direction }
  | { type: "rename"; ref: NodeRef; name: string }
  | { type: "setComment"; id: string; patch: CommentPatch }
  | { type: "option"; id: string; op: "add" | "edit" | "remove" | "up" | "down"; index?: number; value?: string }
  | { type: "saveRequested" }
  | { type: "saveSucceeded"; number: number }
  | { type: "saveFailed"; error: SaveError }
  | { type: "dismissError" }
  | { type: "loadLatest"; number: number }
  | { type: "nameFocused" }
  | { type: "discard" };

const COMMENT_GROUPS = [
  { type: "info", label: "Informational" },
  { type: "limit", label: "Limitations" },
  { type: "defect", label: "Deficiencies" },
] as const;

export type CommentGroup = { type: Comment["commentType"]; label: string; comments: Comment[] };

/**
 * Comments grouped Informational, then Limitations, then Deficiencies, each group in stored order.
 * Empty groups are left out unless `includeEmpty`, which the editor uses so every group has its "+ New".
 */
export function commentGroups(
  comments: readonly Comment[],
  { includeEmpty = false }: { includeEmpty?: boolean } = {},
): CommentGroup[] {
  return COMMENT_GROUPS.map((group) => ({
    type: group.type,
    label: group.label,
    comments: comments.filter((comment) => comment.commentType === group.type),
  })).filter((group) => includeEmpty || group.comments.length > 0);
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
    focusName: null,
    save: { status: "idle" },
    held: null,
    nextTmp: 1,
    note: null,
  };
  if (row !== null) return editorReducer(state, { type: "selectRow", row });
  return selectFirst(state);
}

/** How many Items and Comments a Section holds, for the prompt before deleting it. Null when there is no such Section. */
export function sectionContents(tree: EditableTree, id: string): { items: number; comments: number } | null {
  const section = tree.sections.find((candidate) => candidate.id === id);
  if (!section) return null;
  const comments = section.items.reduce((total, item) => total + item.comments.length, 0);
  return { items: section.items.length, comments };
}

/** "Delete Roof and its 4 Items, 37 Comments?" */
export function deleteSectionPrompt(name: string, contents: { items: number; comments: number }): string {
  const items = `${contents.items} ${contents.items === 1 ? "Item" : "Items"}`;
  const comments = `${contents.comments} ${contents.comments === 1 ? "Comment" : "Comments"}`;
  return `Delete ${name} and its ${items}, ${comments}?`;
}

/** False at an end, at a type group's edge, or when nothing can be edited. */
export function canMove(state: EditorState, ref: NodeRef, dir: Direction): boolean {
  return move(state, ref, dir) !== state;
}

/** True when the working tree differs from the saved Version by value, ids included. */
export function isDirty(state: EditorState): boolean {
  return !sameTree(state.tree, state.base.tree);
}

export function isSavingOrAwaiting(state: EditorState): boolean {
  return state.save.status === "saving" || state.save.status === "awaiting";
}

/** Refusals another Save cannot fix: the base is stale, the Template is gone, or the tree names foreign rows. */
const BLOCKING_REFUSALS: ReadonlySet<SaveError["kind"]> = new Set([
  "stale-base",
  "template-not-found",
  "foreign-source-row",
]);

/** Save is available in edit mode with unsaved edits, nothing in flight, and no refusal that blocks it. */
export function canSave(state: EditorState): boolean {
  if (state.mode === "read-only" || isSavingOrAwaiting(state) || !isDirty(state)) return false;
  return state.save.status !== "refused" || !BLOCKING_REFUSALS.has(state.save.error.kind);
}

/** Every node whose name is empty after trimming, in display order (Comments by type group). */
export function blankNames(tree: EditableTree): NodeRef[] {
  const blank: NodeRef[] = [];
  for (const section of tree.sections) {
    if (section.id && isBlank(section.name)) blank.push({ level: "section", id: section.id });
    for (const item of section.items) {
      if (item.id && isBlank(item.name)) blank.push({ level: "item", id: item.id });
      for (const group of commentGroups(item.comments)) {
        for (const comment of group.comments) {
          if (comment.id && isBlank(comment.name)) blank.push({ level: "comment", id: comment.id });
        }
      }
    }
  }
  return blank;
}

/** `trim` covers U+00A0, as `prepareSave` does. */
function isBlank(name: string): boolean {
  return name.trim() === "";
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
    case "addSection":
      return addSection(state);
    case "addItem":
      return addItem(state);
    case "addComment":
      return addComment(state, action.commentType);
    case "delete":
      return deleteNode(state, action.ref);
    case "move":
      return move(state, action.ref, action.dir);
    case "rename":
      return rename(state, action.ref, action.name);
    case "setComment":
      return setComment(state, action.id, action.patch);
    case "option":
      return changeOptions(state, action.id, action.op, action.index, action.value);
    case "saveRequested":
      return requestSave(state);
    case "saveSucceeded":
      return saveSucceeded(state, action.number);
    case "saveFailed":
      return saveFailed(state, action.error);
    case "dismissError":
      return dismissError(state);
    case "loadLatest":
      return loadLatest(state, action.number);
    case "nameFocused":
      return state.focusName === null ? state : { ...state, focusName: null };
    case "discard":
      return discard(state);
    default: {
      const unreachable: never = action;
      throw new Error(`Unknown editor action: ${String(unreachable)}`);
    }
  }
}

function requestSave(state: EditorState): EditorState {
  if (!canSave(state)) return state;
  const first = blankNames(state.tree)[0];
  if (first) {
    const selected = select(state, first);
    return { ...selected, focus: columnOf(first.level), focusName: first.id, save: { status: "invalid" } };
  }
  // Text cuts stay on this path until a later ticket adds `confirm`.
  prepareSave(state.tree);
  return { ...state, save: { status: "saving" } };
}

function columnOf(level: NodeRef["level"]): Column {
  if (level === "section") return "sections";
  if (level === "item") return "items";
  return "comments";
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
  return { ...state, save: { status: "refused", error } };
}

/**
 * Drops the edits and waits for Version `number` from the page. A Version already held is that one
 * or newer, and the page won't send it again, so it's adopted now.
 */
function loadLatest(state: EditorState, number: number): EditorState {
  if (state.mode === "read-only" || isSavingOrAwaiting(state)) return state;
  const cleared = { ...state, rowMiss: null, focusName: null };
  if (state.held && state.held.number >= number) return replaceVersion(cleared, state.held, { status: "idle" });
  return replaceVersion(cleared, state.base, { status: "awaiting", number });
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
  return { ...replaceVersion(state, nextBase, { status: "idle" }), rowMiss: null, focusName: null };
}

function setComment(state: EditorState, id: string, patch: CommentPatch): EditorState {
  if (state.mode === "read-only") return state;
  if (state.save.status === "saving") return state;
  const place = commentPlace(state.tree, id);
  const current = place?.item.comments[place.commentIndex];
  if (!place || !current) return state;
  const next = applyCommentPatch(current, patch);
  if (sameComment(current, next)) return state;
  // A type change moves the Comment to the end, so it shows last in its new group. Nothing else is cleared.
  const comments = place.item.comments.filter((comment) => comment !== current);
  comments.splice(next.commentType === current.commentType ? place.commentIndex : comments.length, 0, next);
  const note = state.note?.commentId === id && patch.defaultText !== undefined ? null : state.note;
  return { ...state, note, tree: replaceItem(state.tree, place, { ...place.item, comments }) };
}

/** The distinct Recommendations already used in this Template, sorted, for the detail's list. */
export function recommendationChoices(tree: EditableTree): string[] {
  const choices = new Set<string>();
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        if (comment.recommendation !== null) choices.add(comment.recommendation);
      }
    }
  }
  return [...choices].sort();
}

function changeOptions(
  state: EditorState,
  id: string,
  op: "add" | "edit" | "remove" | "up" | "down",
  index: number | undefined,
  value: string | undefined,
): EditorState {
  if (state.mode === "read-only" || state.save.status === "saving") return state;
  const place = commentPlace(state.tree, id);
  const current = place?.item.comments[place.commentIndex];
  if (!place || !current) return state;

  const options = current.choiceOptions.slice();
  let defaultText = current.defaultText;
  let note = state.note;

  if (op === "add") {
    options.push("");
  } else {
    if (index === undefined || options[index] === undefined) return state;
    if (op === "edit") {
      const nextValue = value ?? "";
      const previous = options[index];
      if (previous === nextValue) return state;
      options[index] = nextValue;
      if (previous === defaultText) defaultText = nextValue;
    } else if (op === "remove") {
      const removed = options.splice(index, 1)[0];
      if (current.answerType === "checkbox" && removed === defaultText) {
        defaultText = null;
        note = { commentId: id, kind: "default-cleared" };
      }
    } else {
      const next = swapped(options, index, op === "up" ? index - 1 : index + 1);
      if (!next) return state;
      return writeComment(state, place, { ...current, choiceOptions: next }, note);
    }
  }

  return writeComment(state, place, { ...current, choiceOptions: options, defaultText }, note);
}

function writeComment(
  state: EditorState,
  place: ItemPlace & { commentIndex: number },
  comment: Comment,
  note: EditorState["note"],
): EditorState {
  const comments = place.item.comments.slice();
  comments[place.commentIndex] = comment;
  return { ...state, note, tree: replaceItem(state.tree, place, { ...place.item, comments }) };
}

/** Structure changes wait for an editable, settled state: nothing in flight and not a read-only Version. */
export function canChangeStructure(state: EditorState): boolean {
  return state.mode === "edit" && !isSavingOrAwaiting(state);
}

/** The id the next added node takes. `withNewNode` moves the counter on. */
function newId(state: EditorState): string {
  return `tmp-${state.nextTmp}`;
}

function withNewNode(state: EditorState, tree: EditableTree, focus: Column, selection: EditorSelection, id: string) {
  return { ...state, tree, focus, selection, focusName: id, rowMiss: null, nextTmp: state.nextTmp + 1 };
}

function addSection(state: EditorState): EditorState {
  if (!canChangeStructure(state)) return state;
  const id = newId(state);
  const tree = { sections: [...state.tree.sections, { id, name: "", items: [] }] };
  return withNewNode(state, tree, "sections", { sectionId: id, itemId: null, commentId: null }, id);
}

function addItem(state: EditorState): EditorState {
  if (!canChangeStructure(state)) return state;
  const sectionId = state.selection.sectionId;
  const sectionIndex = state.tree.sections.findIndex((section) => section.id === sectionId);
  const section = state.tree.sections[sectionIndex];
  if (!section || !sectionId) return state;
  const id = newId(state);
  const tree = replaceSection(state.tree, sectionIndex, {
    ...section,
    items: [...section.items, { id, name: "", comments: [] }],
  });
  return withNewNode(state, tree, "items", { sectionId, itemId: id, commentId: null }, id);
}

function addComment(state: EditorState, commentType: Comment["commentType"]): EditorState {
  if (!canChangeStructure(state)) return state;
  const { sectionId, itemId } = state.selection;
  const place = itemPlace(state.tree, itemId);
  if (!place || !sectionId || !itemId) return state;
  const id = newId(state);
  const comment: Comment = {
    id,
    sourceRow: null,
    name: "",
    textHtml: "",
    commentType,
    category: null,
    recommendation: null,
    answerType: "boolean",
    defaultBoolean: null,
    defaultText: null,
    choiceOptions: [],
    unitOptions: [],
  };
  const tree = replaceItem(state.tree, place, { ...place.item, comments: [...place.item.comments, comment] });
  return withNewNode(state, tree, "comments", { sectionId, itemId, commentId: id }, id);
}

function rename(state: EditorState, ref: NodeRef, name: string): EditorState {
  if (ref.level === "comment") return setComment(state, ref.id, { name });
  if (!canChangeStructure(state)) return state;
  if (ref.level === "section") {
    const index = state.tree.sections.findIndex((section) => section.id === ref.id);
    const section = state.tree.sections[index];
    if (!section || section.name === name) return state;
    return { ...state, tree: replaceSection(state.tree, index, { ...section, name }) };
  }
  const place = itemPlace(state.tree, ref.id);
  if (!place || place.item.name === name) return state;
  return { ...state, tree: replaceItem(state.tree, place, { ...place.item, name }) };
}

/**
 * Removes the node with everything under it. A selected node gives way to its next sibling in
 * display order, else the previous one, else nothing at that level.
 */
function deleteNode(state: EditorState, ref: NodeRef): EditorState {
  if (!canChangeStructure(state)) return state;
  if (ref.level === "section") {
    const index = state.tree.sections.findIndex((section) => section.id === ref.id);
    if (index < 0) return state;
    const sections = state.tree.sections.filter((_, other) => other !== index);
    const tree = { sections };
    if (state.selection.sectionId !== ref.id) return { ...state, tree };
    const next = sections[index] ?? sections[index - 1];
    const nextId = nodeId(next);
    const selection = next && nextId ? selectionInSection(nextId, next) : emptySelection();
    return { ...state, tree, selection, rowMiss: null };
  }
  if (ref.level === "item") {
    const place = itemPlace(state.tree, ref.id);
    if (!place) return state;
    const items = place.section.items.filter((_, other) => other !== place.itemIndex);
    const tree = replaceSection(state.tree, place.sectionIndex, { ...place.section, items });
    if (state.selection.itemId !== ref.id) return { ...state, tree };
    const next = items[place.itemIndex] ?? items[place.itemIndex - 1] ?? null;
    const selection = {
      sectionId: state.selection.sectionId,
      itemId: nodeId(next),
      commentId: next ? nodeId(firstDisplayed(next.comments)) : null,
    };
    return { ...state, tree, selection, rowMiss: null };
  }
  const place = commentPlace(state.tree, ref.id);
  if (!place) return state;
  const comments = place.item.comments.filter((comment) => comment.id !== ref.id);
  const tree = replaceItem(state.tree, place, { ...place.item, comments });
  if (state.selection.commentId !== ref.id) return { ...state, tree };
  const displayed = commentGroups(place.item.comments).flatMap((group) => group.comments);
  const at = displayed.findIndex((comment) => comment.id === ref.id);
  const next = displayed[at + 1] ?? displayed[at - 1] ?? null;
  return { ...state, tree, selection: { ...state.selection, commentId: nodeId(next) }, rowMiss: null };
}

/**
 * Sections and Items swap with a neighbour. A Comment swaps with the nearest Comment of its own type
 * in its Item's stored list, so every other Comment keeps its stored place.
 */
function move(state: EditorState, ref: NodeRef, dir: Direction): EditorState {
  if (!canChangeStructure(state)) return state;
  const step = dir === "up" ? -1 : 1;
  if (ref.level === "section") {
    const index = state.tree.sections.findIndex((section) => section.id === ref.id);
    if (index < 0) return state;
    const sections = swapped(state.tree.sections, index, index + step);
    return sections ? { ...state, tree: { sections } } : state;
  }
  if (ref.level === "item") {
    const place = itemPlace(state.tree, ref.id);
    if (!place) return state;
    const items = swapped(place.section.items, place.itemIndex, place.itemIndex + step);
    if (!items) return state;
    return { ...state, tree: replaceSection(state.tree, place.sectionIndex, { ...place.section, items }) };
  }
  const place = commentPlace(state.tree, ref.id);
  if (!place) return state;
  const comments = place.item.comments;
  const type = comments[place.commentIndex]?.commentType;
  let other = place.commentIndex + step;
  while (other >= 0 && other < comments.length && comments[other]?.commentType !== type) other += step;
  const next = swapped(comments, place.commentIndex, other);
  return next ? { ...state, tree: replaceItem(state.tree, place, { ...place.item, comments: next }) } : state;
}

/** A copy with the two entries swapped, or null when `other` is out of range. */
function swapped<T>(list: readonly T[], index: number, other: number): T[] | null {
  const a = list[index];
  const b = list[other];
  if (a === undefined || b === undefined || other < 0) return null;
  const next = list.slice();
  next[index] = b;
  next[other] = a;
  return next;
}

type ItemPlace = { sectionIndex: number; section: Section; itemIndex: number; item: Item };

function itemPlace(tree: EditableTree, id: string | null): ItemPlace | null {
  if (id === null) return null;
  for (let sectionIndex = 0; sectionIndex < tree.sections.length; sectionIndex++) {
    const section = tree.sections[sectionIndex];
    if (!section) continue;
    const itemIndex = section.items.findIndex((item) => item.id === id);
    const item = section.items[itemIndex];
    if (item) return { sectionIndex, section, itemIndex, item };
  }
  return null;
}

function commentPlace(tree: EditableTree, id: string): (ItemPlace & { commentIndex: number }) | null {
  for (let sectionIndex = 0; sectionIndex < tree.sections.length; sectionIndex++) {
    const section = tree.sections[sectionIndex];
    if (!section) continue;
    for (let itemIndex = 0; itemIndex < section.items.length; itemIndex++) {
      const item = section.items[itemIndex];
      const commentIndex = item?.comments.findIndex((comment) => comment.id === id) ?? -1;
      if (item && commentIndex >= 0) return { sectionIndex, section, itemIndex, item, commentIndex };
    }
  }
  return null;
}

function replaceSection(tree: EditableTree, index: number, section: Section): EditableTree {
  const sections = tree.sections.slice();
  sections[index] = section;
  return { sections };
}

function replaceItem(tree: EditableTree, place: ItemPlace, item: Item): EditableTree {
  const items = place.section.items.slice();
  items[place.itemIndex] = item;
  return replaceSection(tree, place.sectionIndex, { ...place.section, items });
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
    case "invalid":
    case "refused":
      if (isDirty(state)) return { ...state, held: copyBase(next) };
      return commitVersion(state, next, state.save);
    default: {
      const unreachable: never = state.save;
      throw new Error(`Unknown save status: ${String(unreachable)}`);
    }
  }
}

function commitVersion(state: EditorState, next: EditorBase, save: SaveState): EditorState {
  return replaceVersion(state, copyBase(next), save);
}

/** Puts `base` in place of the working tree and keeps the selection by its place. */
function replaceVersion(state: EditorState, base: EditorBase, save: SaveState): EditorState {
  const path = indexPath(state.tree, state.selection);
  return {
    ...state,
    base,
    tree: base.tree,
    selection: path ? selectionAt(base.tree, path) : emptySelection(),
    save,
    held: null,
    note: null,
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
