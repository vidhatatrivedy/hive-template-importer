import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { EditableTree } from "@/core/import/schemas";
import type { SaveError } from "@/core/import/editor-messages";
import {
  blankNames,
  canSave,
  editorReducer,
  initialEditorState,
  isDirty,
  canMove,
  commentGroups,
  deleteSectionPrompt,
  locate,
  sectionContents,
  type EditorMode,
  type EditorState,
} from "@/app/editor/editor-state";

const FIXTURE = path.resolve(
  __dirname,
  "../../../fixtures/spectora/InterNACHI Residential -2026-09-30.xls",
);
const BEN = path.resolve(
  __dirname,
  "../../../fixtures/spectora/Ben Gromicko's Template for Home Inspections-2026-09-30.xls",
);

let tree: EditableTree;

beforeAll(async () => {
  const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
  const result = await parseSpectoraExport(bytes, path.basename(FIXTURE));
  if (!result.ok) throw new Error(result.rejection.kind);
  tree = withIds(result.draft.tree);
});

function open(row: number | null = null, mode: EditorMode = "edit"): EditorState {
  return initialEditorState({ versionId: "version-1", number: 1, tree, row, mode });
}

describe("editorReducer", () => {
  it("opens on the first Section, its first Item and that Item's first Informational Comment, with the Sections column focused", () => {
    const opened = open();
    const { section, item, comment } = located(opened);

    expect(section?.name).toBe("Inspection Details");
    expect(item?.name).toBe("General");
    expect(comment?.name).toBe("In Attendance");
    expect(comment?.sourceRow).toBe(2);
    expect(opened.focus).toBe("sections");
    expect(opened.rowMiss).toBeNull();
  });

  it("opens on the Comment that carries the page's Source row and focuses Comments", () => {
    const opened = open(149);
    const { section, item, comment } = located(opened);

    expect(section?.name).toBe("Cooling");
    expect(item?.name).toBe("Cooling Equipment");
    expect(comment?.name).toBe("Brand");
    expect(comment?.sourceRow).toBe(149);
    expect(opened.focus).toBe("comments");
    expect(opened.rowMiss).toBeNull();
  });

  it("opens with nothing selected when the page's Source row is not in this Version", () => {
    const opened = open(99999);

    expect(opened.selection).toEqual({ sectionId: null, itemId: null, commentId: null });
    expect(opened.focus).toBe("sections");
    expect(opened.rowMiss).toBe(99999);
  });

  it("selects the Comment that carries a Source row and focuses Comments", () => {
    const next = editorReducer(open(), { type: "selectRow", row: 149 });
    const { section, item, comment } = located(next);

    expect(section?.name).toBe("Cooling");
    expect(item?.name).toBe("Cooling Equipment");
    expect(comment?.name).toBe("Brand");
    expect(next.focus).toBe("comments");
    expect(next.rowMiss).toBeNull();
  });

  it("leaves the selection unchanged when no Comment carries that Source row", () => {
    const picked = editorReducer(open(), {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });
    const missed = editorReducer(picked, { type: "selectRow", row: 99999 });

    expect(missed.selection).toEqual(picked.selection);
    expect(missed.focus).toBe(picked.focus);
    expect(missed.rowMiss).toBe(99999);
  });

  it("stops reporting a missing Source row when the inspector selects something", () => {
    const missed = editorReducer(open(), { type: "selectRow", row: 99999 });
    const picked = editorReducer(missed, {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });

    expect(picked.rowMiss).toBeNull();
    expect(located(picked).comment?.name).toBe("Brand");
  });

  it("picking a Section selects its first Item and that Item's first Comment in display order, and focuses Items", () => {
    const next = editorReducer(open(), {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });
    const { section, item, comment } = located(next);

    expect(section?.name).toBe("Cooling");
    expect(item?.name).toBe("Cooling Equipment");
    // Stored order starts with the defect "Air Flow Restricted" (row 148). Display order is Informational first.
    expect(comment?.name).toBe("Brand");
    expect(comment?.sourceRow).toBe(149);
    expect(next.focus).toBe("items");
  });

  it("picking an Item focuses Comments on that Item's first Comment in display order", () => {
    const section = editorReducer(open(), {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Exterior") },
    });
    const next = editorReducer(section, {
      type: "select",
      ref: { level: "item", id: idOf(tree, "Exterior", "Exterior Doors") },
    });
    const { item, comment } = located(next);

    expect(item?.name).toBe("Exterior Doors");
    // Stored order starts with the defect "Door Does Not Close or Latch" (row 21).
    expect(comment?.name).toBe("Exterior Entry Door");
    expect(comment?.sourceRow).toBe(22);
    expect(next.focus).toBe("comments");
  });

  it("picking a Comment focuses Comments and keeps that Comment", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const next = editorReducer(opened, { type: "select", ref: { level: "comment", id: commentId } });

    expect(next.focus).toBe("comments");
    expect(next.selection).toEqual({ ...opened.selection, commentId });
  });

  it("focuses the column a strip or breadcrumb names without moving the selection", () => {
    const picked = editorReducer(open(), {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });
    const next = editorReducer(picked, { type: "focus", column: "sections" });

    expect(next.focus).toBe("sections");
    expect(next.selection).toEqual(picked.selection);
  });

  it("keeps the same Comment when a newer Version arrives with new ids", () => {
    const picked = editorReducer(open(), {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });
    const adopted = editorReducer(picked, {
      type: "serverVersion",
      versionId: "version-2",
      number: 2,
      tree: retag(tree),
    });
    const { section, item, comment } = located(adopted);

    expect(section?.name).toBe("Cooling");
    expect(item?.name).toBe("Cooling Equipment");
    expect(comment?.name).toBe("Brand");
    expect(comment?.sourceRow).toBe(149);
    expect(adopted.selection.commentId?.startsWith("next-")).toBe(true);
    expect(adopted.focus).toBe("items");
    expect(adopted.base).toMatchObject({ versionId: "version-2", number: 2 });
  });

  it("is clean on load, dirty after a Comment is renamed, and clean again when the old name is typed back", () => {
    const opened = open();
    const commentId = requireCommentId(opened);

    expect(isDirty(opened)).toBe(false);
    expect(located(opened).comment?.name).toBe("In Attendance");

    const edited = editorReducer(opened, {
      type: "setComment",
      id: commentId,
      patch: { name: "In Attendance " },
    });

    expect(located(edited).comment?.name).toBe("In Attendance ");
    expect(isDirty(edited)).toBe(true);

    const restored = editorReducer(edited, {
      type: "setComment",
      id: commentId,
      patch: { name: "In Attendance" },
    });

    expect(located(restored).comment?.name).toBe("In Attendance");
    expect(isDirty(restored)).toBe(false);
  });

  it("does nothing when Save is pressed and nothing has changed", () => {
    const opened = open();
    expect(editorReducer(opened, { type: "saveRequested" })).toBe(opened);
  });

  it("locks edits while Save is in flight, then waits for the new Version", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, {
      type: "setComment",
      id: commentId,
      patch: { name: "Attendance note" },
    });
    const saving = editorReducer(edited, { type: "saveRequested" });

    expect(saving.save).toEqual({ status: "saving" });
    expect(located(saving).comment?.name).toBe("Attendance note");
    expect(
      editorReducer(saving, { type: "setComment", id: commentId, patch: { name: "Ignored" } }),
    ).toBe(saving);
    expect(editorReducer(saving, { type: "saveRequested" })).toBe(saving);

    const arrived = editorReducer(saving, {
      type: "serverVersion",
      versionId: "version-2",
      number: 2,
      tree: retag(renameComment(tree, commentId, "Attendance note")),
    });
    expect(arrived.save).toEqual({ status: "saving" });
    expect(located(arrived).comment?.name).toBe("Attendance note");
    expect(located(arrived).comment?.id).toBe(commentId);

    const adopted = editorReducer(arrived, { type: "saveSucceeded", number: 2 });
    expect(adopted.save).toEqual({ status: "idle" });
    expect(isDirty(adopted)).toBe(false);
    expect(located(adopted).comment?.id).toBe(`next-${commentId}`);
    expect(located(adopted).comment?.name).toBe("Attendance note");

    const awaiting = editorReducer(saving, { type: "saveSucceeded", number: 2 });
    expect(awaiting.save).toEqual({ status: "awaiting", number: 2 });
    expect(located(awaiting).comment?.name).toBe("Attendance note");
  });

  it("adopts the saved Version, or any newer one, and keeps the same Comment selected", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const awaiting = awaitingSave(opened, commentId, "Attendance note");
    const saved = editorReducer(awaiting, {
      type: "serverVersion",
      versionId: "version-2",
      number: 2,
      tree: retag(renameComment(tree, commentId, "Attendance note")),
    });
    const { section, item, comment } = located(saved);

    expect(saved.save).toEqual({ status: "idle" });
    expect(isDirty(saved)).toBe(false);
    expect(section?.name).toBe("Inspection Details");
    expect(item?.name).toBe("General");
    expect(comment?.name).toBe("Attendance note");
    expect(comment?.id).toBe(`next-${commentId}`);

    const later = editorReducer(awaiting, {
      type: "serverVersion",
      versionId: "version-3",
      number: 3,
      tree: retag(renameComment(tree, commentId, "Attendance note")),
    });
    expect(later.save).toEqual({ status: "idle" });
    expect(located(later).comment?.id).toBe(`next-${commentId}`);
    expect(located(later).comment?.name).toBe("Attendance note");
  });

  it("ignores an older Version while waiting for the one just saved", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const awaiting = awaitingSave(opened, commentId, "Attendance note");
    const ignored = editorReducer(awaiting, {
      type: "serverVersion",
      versionId: "version-1",
      number: 1,
      tree: retag(tree),
    });

    expect(ignored).toBe(awaiting);
    expect(located(ignored).comment?.name).toBe("Attendance note");
    expect(located(ignored).comment?.id).toBe(commentId);
  });

  it("keeps the renamed Comment when Save fails, and Dismiss clears the error", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, {
      type: "setComment",
      id: commentId,
      patch: { name: "Attendance note" },
    });
    const refused = editorReducer(editorReducer(edited, { type: "saveRequested" }), {
      type: "saveFailed",
      error: { kind: "save-failed" },
    });

    expect(refused.save).toEqual({ status: "refused", error: { kind: "save-failed" } });
    expect(located(refused).comment?.name).toBe("Attendance note");
    expect(isDirty(refused)).toBe(true);

    const dismissed = editorReducer(refused, { type: "dismissError" });
    expect(dismissed.save).toEqual({ status: "idle" });
    expect(located(dismissed).comment?.name).toBe("Attendance note");
    expect(isDirty(dismissed)).toBe(true);
  });

  it("Discard returns to the saved Version, keeps the selected Comment by its place, and clears the Save error", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, {
      type: "setComment",
      id: commentId,
      patch: { name: "Attendance note" },
    });
    const picked = editorReducer(edited, {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });
    const refused = editorReducer(editorReducer(picked, { type: "saveRequested" }), {
      type: "saveFailed",
      error: { kind: "save-failed" },
    });
    const missed = editorReducer(refused, { type: "selectRow", row: 99999 });

    const discarded = editorReducer(missed, { type: "discard" });
    const { section, item, comment } = located(discarded);
    const attendance = discarded.tree.sections
      .flatMap((candidate) => candidate.items)
      .flatMap((candidate) => candidate.comments)
      .find((candidate) => candidate.sourceRow === 2);

    expect(attendance?.name).toBe("In Attendance");
    expect(section?.name).toBe("Cooling");
    expect(item?.name).toBe("Cooling Equipment");
    expect(comment?.name).toBe("Brand");
    expect(comment?.sourceRow).toBe(149);
    expect(comment?.id).toBe(picked.selection.commentId);
    expect(discarded.focus).toBe(picked.focus);
    expect(discarded.save).toEqual({ status: "idle" });
    expect(discarded.rowMiss).toBeNull();
    expect(discarded.held).toBeNull();
    expect(isDirty(discarded)).toBe(false);
  });

  it("Discard adopts a Version that arrived while Save was in flight and keeps the Comment by its place", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, {
      type: "setComment",
      id: commentId,
      patch: { name: "Attendance note" },
    });
    const saving = editorReducer(edited, { type: "saveRequested" });
    const arrived = editorReducer(saving, {
      type: "serverVersion",
      versionId: "version-2",
      number: 2,
      tree: retag(tree),
    });

    const discarded = editorReducer(arrived, { type: "discard" });
    const { section, item, comment } = located(discarded);

    expect(located(arrived).comment?.name).toBe("Attendance note");
    expect(section?.name).toBe("Inspection Details");
    expect(item?.name).toBe("General");
    expect(comment?.name).toBe("In Attendance");
    expect(comment?.id).toBe(`next-${commentId}`);
    expect(discarded.base).toMatchObject({ versionId: "version-2", number: 2 });
    expect(discarded.held).toBeNull();
    expect(discarded.save).toEqual({ status: "idle" });
    expect(isDirty(discarded)).toBe(false);
  });

  it("Discard does nothing while viewing a read-only Version", () => {
    const viewing = open(null, "read-only");
    const commentId = requireCommentId(viewing);

    expect(editorReducer(viewing, { type: "discard" })).toBe(viewing);
    expect(
      editorReducer(viewing, { type: "setComment", id: commentId, patch: { name: "Changed" } }),
    ).toBe(viewing);
    expect(editorReducer(viewing, { type: "saveRequested" })).toBe(viewing);
    expect(viewing.base).toEqual({ versionId: "version-1", number: 1, tree });
  });

  it("keeps the inspector's selection when the same Version is read again", () => {
    const picked = editorReducer(open(), {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });
    const again = editorReducer(picked, {
      type: "serverVersion",
      versionId: "version-1",
      number: 1,
      tree,
    });

    expect(again.selection).toEqual(picked.selection);
    expect(again.focus).toBe(picked.focus);
  });
});

describe("editorReducer: Save refusals", () => {
  it("refuses a Save with blank names, selects the first and focuses its column, and clears each marker as it is named", () => {
    const opened = open();
    const attendance = requireCommentId(opened);
    const brand = commentIdAt(tree, 149);
    const blanked = editorReducer(
      editorReducer(opened, { type: "setComment", id: brand, patch: { name: " \u00a0" } }),
      { type: "setComment", id: attendance, patch: { name: "" } },
    );
    const elsewhere = editorReducer(blanked, {
      type: "select",
      ref: { level: "section", id: idOf(tree, "Cooling") },
    });

    const invalid = editorReducer(elsewhere, { type: "saveRequested" });

    expect(invalid.save).toEqual({ status: "invalid" });
    expect(invalid.selection.commentId).toBe(attendance);
    expect(located(invalid).section?.name).toBe("Inspection Details");
    expect(invalid.focus).toBe("comments");
    expect(invalid.focusName).toBe(attendance);
    expect(blankNames(invalid.tree)).toEqual([
      { level: "comment", id: attendance },
      { level: "comment", id: brand },
    ]);
    expect(canSave(invalid)).toBe(true);

    const oneNamed = editorReducer(invalid, { type: "setComment", id: attendance, patch: { name: "Present" } });
    expect(blankNames(oneNamed.tree)).toEqual([{ level: "comment", id: brand }]);

    const allNamed = editorReducer(oneNamed, { type: "setComment", id: brand, patch: { name: "Make" } });
    expect(blankNames(allNamed.tree)).toEqual([]);
    expect(editorReducer(allNamed, { type: "saveRequested" }).save).toEqual({ status: "saving" });
  });

  it("selects a blank Item before the blank Comments under it and focuses the Items column", () => {
    const itemId = idOf(tree, "Cooling", "Cooling Equipment");
    const unnamed: EditableTree = {
      sections: tree.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => (item.id === itemId ? { ...item, name: "" } : item)),
      })),
    };
    const opened = initialEditorState({ versionId: "version-1", number: 1, tree: unnamed, row: null });
    const brand = commentIdAt(unnamed, 149);
    const edited = editorReducer(opened, { type: "setComment", id: brand, patch: { name: "" } });

    const invalid = editorReducer(edited, { type: "saveRequested" });

    expect(invalid.save).toEqual({ status: "invalid" });
    expect(invalid.selection.sectionId).toBe(idOf(tree, "Cooling"));
    expect(invalid.selection.itemId).toBe(itemId);
    expect(invalid.focus).toBe("items");
    expect(invalid.focusName).toBe(itemId);
    expect(blankNames(invalid.tree)).toEqual([
      { level: "item", id: itemId },
      { level: "comment", id: brand },
    ]);
  });

  it("holds a newer Version that arrives while there are unsaved edits, and Discard adopts it", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, { type: "setComment", id: commentId, patch: { name: "Attendance note" } });

    const arrived = editorReducer(edited, {
      type: "serverVersion",
      versionId: "version-2",
      number: 2,
      tree: retag(tree),
    });

    expect(located(arrived).comment?.name).toBe("Attendance note");
    expect(located(arrived).comment?.id).toBe(commentId);
    expect(arrived.base).toMatchObject({ versionId: "version-1", number: 1 });
    expect(arrived.held).toMatchObject({ versionId: "version-2", number: 2 });
    expect(isDirty(arrived)).toBe(true);

    const discarded = editorReducer(arrived, { type: "discard" });
    expect(discarded.base).toMatchObject({ versionId: "version-2", number: 2 });
    expect(located(discarded).comment?.id).toBe(`next-${commentId}`);
    expect(discarded.held).toBeNull();
    expect(isDirty(discarded)).toBe(false);
  });

  it("keeps the edits on a stale-base refusal, and Load latest drops them and adopts that Version or a newer one", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, { type: "setComment", id: commentId, patch: { name: "Attendance note" } });
    const refused = editorReducer(editorReducer(edited, { type: "saveRequested" }), {
      type: "saveFailed",
      error: { kind: "stale-base", latestNumber: 3 },
    });

    expect(refused.save).toEqual({ status: "refused", error: { kind: "stale-base", latestNumber: 3 } });
    expect(located(refused).comment?.name).toBe("Attendance note");
    expect(isDirty(refused)).toBe(true);
    expect(canSave(refused)).toBe(false);

    const loading = editorReducer(refused, { type: "loadLatest", number: 3 });
    expect(loading.save).toEqual({ status: "awaiting", number: 3 });
    expect(located(loading).comment?.name).toBe("In Attendance");
    expect(isDirty(loading)).toBe(false);

    const older = editorReducer(loading, { type: "serverVersion", versionId: "version-2", number: 2, tree: retag(tree) });
    expect(older.base).toMatchObject({ number: 1 });
    expect(older.save).toEqual({ status: "awaiting", number: 3 });

    const latest = editorReducer(loading, {
      type: "serverVersion",
      versionId: "version-4",
      number: 4,
      tree: retag(renameComment(tree, commentId, "Present")),
    });
    expect(latest.base).toMatchObject({ versionId: "version-4", number: 4 });
    expect(latest.save).toEqual({ status: "idle" });
    expect(located(latest).comment?.name).toBe("Present");
    expect(located(latest).comment?.id).toBe(`next-${commentId}`);
  });

  it("Load latest adopts a Version already held, since the page will not send it again", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, { type: "setComment", id: commentId, patch: { name: "Attendance note" } });
    const held = editorReducer(edited, {
      type: "serverVersion",
      versionId: "version-2",
      number: 2,
      tree: retag(renameComment(tree, commentId, "Present")),
    });
    const refused = editorReducer(editorReducer(held, { type: "saveRequested" }), {
      type: "saveFailed",
      error: { kind: "stale-base", latestNumber: 2 },
    });
    expect(refused.held).toMatchObject({ versionId: "version-2" });

    const loaded = editorReducer(refused, { type: "loadLatest", number: 2 });
    expect(loaded.base).toMatchObject({ versionId: "version-2", number: 2 });
    expect(loaded.save).toEqual({ status: "idle" });
    expect(loaded.held).toBeNull();
    expect(located(loaded).comment?.name).toBe("Present");
  });

  it("keeps Save available after names-blank and save-failed, and not after a refusal Save cannot fix", () => {
    const opened = open();
    const commentId = requireCommentId(opened);
    const edited = editorReducer(opened, { type: "setComment", id: commentId, patch: { name: "Attendance note" } });
    const saving = editorReducer(edited, { type: "saveRequested" });
    const refusedWith = (error: SaveError) => editorReducer(saving, { type: "saveFailed", error });

    expect(canSave(refusedWith({ kind: "save-failed" }))).toBe(true);
    expect(canSave(refusedWith({ kind: "names-blank", count: 1 }))).toBe(true);
    expect(canSave(refusedWith({ kind: "template-not-found" }))).toBe(false);
    expect(canSave(refusedWith({ kind: "foreign-source-row", rowNumbers: [9] }))).toBe(false);

    const gone = refusedWith({ kind: "template-not-found" });
    expect(editorReducer(gone, { type: "saveRequested" })).toBe(gone);
    expect(located(gone).comment?.name).toBe("Attendance note");
    const dismissed = editorReducer(refusedWith({ kind: "foreign-source-row", rowNumbers: [9] }), {
      type: "dismissError",
    });
    expect(dismissed.save).toEqual({ status: "idle" });
    expect(canSave(dismissed)).toBe(true);
  });
});

function commentIdAt(source: EditableTree, sourceRow: number): string {
  for (const section of source.sections) {
    for (const item of section.items) {
      const comment = item.comments.find((candidate) => candidate.sourceRow === sourceRow);
      if (comment?.id) return comment.id;
    }
  }
  throw new Error(`No Comment at row ${sourceRow}`);
}

function requireCommentId(state: EditorState): string {
  const commentId = state.selection.commentId;
  if (!commentId) throw new Error("expected a Comment");
  return commentId;
}

function awaitingSave(opened: EditorState, commentId: string, name: string): EditorState {
  const edited = editorReducer(opened, { type: "setComment", id: commentId, patch: { name } });
  const saving = editorReducer(edited, { type: "saveRequested" });
  return editorReducer(saving, { type: "saveSucceeded", number: 2 });
}

function renameComment(source: EditableTree, commentId: string, name: string): EditableTree {
  return {
    sections: source.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        comments: item.comments.map((comment) => (comment.id === commentId ? { ...comment, name } : comment)),
      })),
    })),
  };
}

describe("editorReducer: structure", () => {
  it("adds a Section at the end, empty and unnamed, selects it and puts its name in focus", () => {
    const added = editorReducer(open(), { type: "addSection" });
    const last = added.tree.sections.at(-1);

    expect(added.tree.sections).toHaveLength(tree.sections.length + 1);
    expect(last).toEqual({ id: "tmp-1", name: "", items: [] });
    expect(added.selection).toEqual({ sectionId: "tmp-1", itemId: null, commentId: null });
    expect(added.focus).toBe("sections");
    expect(added.focusName).toBe("tmp-1");
    expect(isDirty(added)).toBe(true);
  });

  it("adds an Item at the end of the selected Section with no Comments, and numbers each new node apart", () => {
    const cooling = editorReducer(open(), { type: "select", ref: { level: "section", id: idOf(tree, "Cooling") } });
    const added = editorReducer(editorReducer(cooling, { type: "addItem" }), { type: "addItem" });
    const items = located(added).section?.items ?? [];

    expect(items).toHaveLength(5);
    expect(items.at(-2)).toEqual({ id: "tmp-1", name: "", comments: [] });
    expect(items.at(-1)).toEqual({ id: "tmp-2", name: "", comments: [] });
    expect(added.selection).toEqual({ sectionId: idOf(tree, "Cooling"), itemId: "tmp-2", commentId: null });
    expect(added.focus).toBe("items");
    expect(added.focusName).toBe("tmp-2");
  });

  it("adds a Comment of the given type at the end of the selected Item, so it shows last in its group, with no Category", () => {
    const picked = editorReducer(open(), {
      type: "select",
      ref: { level: "item", id: idOf(tree, "Cooling", "Cooling Equipment") },
    });
    const added = editorReducer(picked, { type: "addComment", commentType: "defect" });
    const item = located(added).item;

    expect(item?.comments).toHaveLength(15);
    expect(item?.comments.at(-1)).toEqual({
      id: "tmp-1",
      sourceRow: null,
      name: "",
      textHtml: "",
      commentType: "defect",
      category: null,
      recommendation: null,
      answerType: "boolean",
      defaultBoolean: null,
      defaultText: null,
      choiceOptions: [],
      unitOptions: [],
    });
    const defects = commentGroups(item?.comments ?? []).find((group) => group.label === "Deficiencies");
    expect(defects?.comments.at(-1)?.id).toBe("tmp-1");
    expect(added.selection.commentId).toBe("tmp-1");
    expect(added.focus).toBe("comments");
    expect(added.focusName).toBe("tmp-1");
  });

  it("adds nothing when there is no parent to add to", () => {
    const empty = initialEditorState({ versionId: "blank-1", number: 1, tree: { sections: [] }, row: null });
    expect(editorReducer(empty, { type: "addItem" })).toBe(empty);
    expect(editorReducer(empty, { type: "addComment", commentType: "info" })).toBe(empty);

    const section = editorReducer(empty, { type: "addSection" });
    expect(editorReducer(section, { type: "addComment", commentType: "info" })).toBe(section);
  });

  it("builds a blank Template from nothing: a Section, an Item and a Comment", () => {
    const empty = initialEditorState({ versionId: "blank-1", number: 1, tree: { sections: [] }, row: null });
    const built = [
      { type: "addSection" } as const,
      { type: "rename", ref: { level: "section", id: "tmp-1" }, name: "Roof" } as const,
      { type: "addItem" } as const,
      { type: "rename", ref: { level: "item", id: "tmp-2" }, name: "Coverings" } as const,
      { type: "addComment", commentType: "info" } as const,
      { type: "setComment", id: "tmp-3", patch: { name: "Material" } } as const,
    ].reduce(editorReducer, empty);

    expect(built.tree.sections).toHaveLength(1);
    expect(built.tree.sections[0]?.name).toBe("Roof");
    expect(built.tree.sections[0]?.items[0]?.name).toBe("Coverings");
    expect(built.tree.sections[0]?.items[0]?.comments[0]?.name).toBe("Material");
    expect(blankNames(built.tree)).toEqual([]);
    expect(editorReducer(built, { type: "saveRequested" }).save).toEqual({ status: "saving" });
  });

  it("renames a Section and an Item in place, and typing the old name back is clean", () => {
    const sectionId = idOf(tree, "Cooling");
    const itemId = idOf(tree, "Cooling", "Cooling Equipment");
    const renamed = editorReducer(
      editorReducer(open(), { type: "rename", ref: { level: "section", id: sectionId }, name: "Air conditioning" }),
      { type: "rename", ref: { level: "item", id: itemId }, name: "Units" },
    );

    expect(renamed.tree.sections.find((section) => section.id === sectionId)?.name).toBe("Air conditioning");
    expect(renamed.tree.sections.find((section) => section.id === sectionId)?.items[0]?.name).toBe("Units");
    expect(isDirty(renamed)).toBe(true);

    const back = editorReducer(
      editorReducer(renamed, { type: "rename", ref: { level: "section", id: sectionId }, name: "Cooling" }),
      { type: "rename", ref: { level: "item", id: itemId }, name: "Cooling Equipment" },
    );
    expect(isDirty(back)).toBe(false);
  });

  it("deletes a Section with everything in it and selects the next Section", () => {
    const sectionId = idOf(tree, "Cooling");
    const picked = editorReducer(open(), { type: "select", ref: { level: "section", id: sectionId } });
    const deleted = editorReducer(picked, { type: "delete", ref: { level: "section", id: sectionId } });

    expect(deleted.tree.sections).toHaveLength(tree.sections.length - 1);
    expect(deleted.tree.sections.some((section) => section.id === sectionId)).toBe(false);
    expect(blankNames(deleted.tree)).toEqual([]);
    expect(located(deleted).section?.name).toBe("Plumbing");
    expect(located(deleted).item).not.toBeNull();
    expect(isDirty(deleted)).toBe(true);
  });

  it("deleting the last Item selects the previous one, and deleting the only one selects nothing at that level", () => {
    const itemId = idOf(tree, "Cooling", "Distribution System");
    const picked = editorReducer(open(), { type: "select", ref: { level: "item", id: itemId } });
    const deleted = editorReducer(picked, { type: "delete", ref: { level: "item", id: itemId } });
    expect(located(deleted).item?.name).toBe("Normal Operating Controls");

    const empty = initialEditorState({ versionId: "blank-1", number: 1, tree: { sections: [] }, row: null });
    const one = editorReducer(editorReducer(empty, { type: "addSection" }), { type: "addItem" });
    const none = editorReducer(one, { type: "delete", ref: { level: "item", id: "tmp-2" } });
    expect(none.selection).toEqual({ sectionId: "tmp-1", itemId: null, commentId: null });
  });

  it("deleting a Comment selects the next one in display order, across groups", () => {
    const item = idOf(tree, "Cooling", "Cooling Equipment");
    const picked = editorReducer(open(), { type: "select", ref: { level: "item", id: item } });
    // Display order: info 149, 151, 153, 155; limit 150; defects 148, 152, …
    const seer = commentIdAt(tree, 155);
    const deleted = editorReducer(
      editorReducer(picked, { type: "select", ref: { level: "comment", id: seer } }),
      { type: "delete", ref: { level: "comment", id: seer } },
    );

    expect(located(deleted).item?.comments).toHaveLength(13);
    expect(located(deleted).comment?.sourceRow).toBe(150);

    const vegetation = commentIdAt(tree, 161);
    const last = editorReducer(
      editorReducer(picked, { type: "select", ref: { level: "comment", id: vegetation } }),
      { type: "delete", ref: { level: "comment", id: vegetation } },
    );
    expect(located(last).comment?.sourceRow).toBe(160);

    const elsewhere = editorReducer(picked, { type: "delete", ref: { level: "comment", id: vegetation } });
    expect(elsewhere.selection).toEqual(picked.selection);
  });

  it("adding a node and deleting it again is clean", () => {
    const added = editorReducer(open(), { type: "addComment", commentType: "limit" });
    expect(isDirty(added)).toBe(true);
    const removed = editorReducer(added, { type: "delete", ref: { level: "comment", id: "tmp-1" } });
    expect(isDirty(removed)).toBe(false);
  });

  it("counts a Section's Items and Comments for the delete prompt", () => {
    expect(sectionContents(tree, idOf(tree, "Roof"))).toEqual({ items: 5, comments: 35 });
    expect(sectionContents(tree, idOf(tree, "Cooling"))).toEqual({ items: 3, comments: 24 });
    expect(sectionContents(tree, "missing")).toBeNull();
    expect(deleteSectionPrompt("Roof", { items: 5, comments: 35 })).toBe("Delete Roof and its 5 Items, 35 Comments?");
    expect(deleteSectionPrompt("Roof", { items: 1, comments: 1 })).toBe("Delete Roof and its 1 Item, 1 Comment?");
  });

  it("swaps Sections and Items with a neighbour, does nothing at an end, and up then down is clean", () => {
    const cooling = idOf(tree, "Cooling");
    const up = editorReducer(open(), { type: "move", ref: { level: "section", id: cooling }, dir: "up" });
    expect(up.tree.sections.map((section) => section.name).slice(3, 6)).toEqual([
      "Basement, Foundation, Crawlspace & Structure",
      "Cooling",
      "Heating",
    ]);
    expect(isDirty(up)).toBe(true);
    expect(isDirty(editorReducer(up, { type: "move", ref: { level: "section", id: cooling }, dir: "down" }))).toBe(
      false,
    );

    const first = { level: "section", id: idOf(tree, "Inspection Details") } as const;
    expect(editorReducer(open(), { type: "move", ref: first, dir: "up" }).tree).toBe(tree);
    expect(canMove(open(), first, "up")).toBe(false);
    expect(canMove(open(), first, "down")).toBe(true);

    const lastItem = { level: "item", id: idOf(tree, "Cooling", "Distribution System") } as const;
    expect(editorReducer(open(), { type: "move", ref: lastItem, dir: "down" }).tree).toBe(tree);
    const itemUp = editorReducer(open(), { type: "move", ref: lastItem, dir: "up" });
    expect(itemUp.tree.sections.find((section) => section.id === cooling)?.items.map((item) => item.name)).toEqual([
      "Cooling Equipment",
      "Distribution System",
      "Normal Operating Controls",
    ]);
  });

  it("moving a defect up skips over the info and limitation Comments between them, and nothing else moves", () => {
    const itemId = idOf(tree, "Cooling", "Cooling Equipment");
    const rowsOf = (state: EditorState) =>
      located(editorReducer(state, { type: "select", ref: { level: "item", id: itemId } })).item?.comments.map(
        (comment) => comment.sourceRow,
      );
    const groupsOf = (state: EditorState) =>
      commentGroups(
        located(editorReducer(state, { type: "select", ref: { level: "item", id: itemId } })).item?.comments ?? [],
      ).map((group) => [group.label, group.comments.map((comment) => comment.sourceRow)]);

    const moved = editorReducer(open(), {
      type: "move",
      ref: { level: "comment", id: commentIdAt(tree, 152) },
      dir: "up",
    });

    expect(rowsOf(moved)).toEqual([152, 149, 150, 151, 148, 153, 154, 155, 156, 157, 158, 159, 160, 161]);
    expect(groupsOf(moved)).toEqual([
      ["Informational", [149, 151, 153, 155]],
      ["Limitations", [150]],
      ["Deficiencies", [152, 148, 154, 156, 157, 158, 159, 160, 161]],
    ]);

    const back = editorReducer(moved, {
      type: "move",
      ref: { level: "comment", id: commentIdAt(tree, 152) },
      dir: "down",
    });
    expect(isDirty(back)).toBe(false);
  });

  it("does nothing when a Comment is already at its group's edge", () => {
    const opened = open();
    const firstDefect = { level: "comment", id: commentIdAt(tree, 148) } as const;
    const onlyLimit = { level: "comment", id: commentIdAt(tree, 150) } as const;
    const lastInfo = { level: "comment", id: commentIdAt(tree, 155) } as const;

    expect(editorReducer(opened, { type: "move", ref: firstDefect, dir: "up" })).toBe(opened);
    expect(editorReducer(opened, { type: "move", ref: onlyLimit, dir: "up" })).toBe(opened);
    expect(editorReducer(opened, { type: "move", ref: onlyLimit, dir: "down" })).toBe(opened);
    expect(editorReducer(opened, { type: "move", ref: lastInfo, dir: "down" })).toBe(opened);
    expect(canMove(opened, lastInfo, "down")).toBe(false);
    expect(canMove(opened, lastInfo, "up")).toBe(true);
  });

  it("changes no structure in read-only mode or while Save is in flight", () => {
    const readOnly = open(null, "read-only");
    const sectionRef = { level: "section", id: idOf(tree, "Cooling") } as const;
    for (const action of [
      { type: "addSection" },
      { type: "addItem" },
      { type: "addComment", commentType: "info" },
      { type: "delete", ref: sectionRef },
      { type: "move", ref: sectionRef, dir: "up" },
      { type: "rename", ref: sectionRef, name: "Renamed" },
    ] as const) {
      expect(editorReducer(readOnly, action)).toBe(readOnly);
    }

    const edited = editorReducer(open(), { type: "rename", ref: sectionRef, name: "Renamed" });
    const saving = editorReducer(edited, { type: "saveRequested" });
    expect(saving.save.status).toBe("saving");
    expect(editorReducer(saving, { type: "addSection" })).toBe(saving);
    expect(editorReducer(saving, { type: "delete", ref: sectionRef })).toBe(saving);
  });
});

describe("editorReducer on Ben", () => {
  let ben: EditableTree;

  beforeAll(async () => {
    const bytes = new Uint8Array(fs.readFileSync(BEN));
    const result = await parseSpectoraExport(bytes, path.basename(BEN));
    if (!result.ok) throw new Error(result.rejection.kind);
    ben = withIds(result.draft.tree);
  });

  it("a name edit leaves every other Section as the same object, and the Template is dirty", () => {
    const opened = initialEditorState({ versionId: "ben-1", number: 1, tree: ben, row: null });
    const commentId = requireCommentId(opened);
    const sectionIndex = ben.sections.findIndex((section) => section.id === opened.selection.sectionId);
    if (sectionIndex < 0) throw new Error("expected a Section");

    const edited = editorReducer(opened, {
      type: "setComment",
      id: commentId,
      patch: { name: "Renamed on Ben" },
    });

    expect(isDirty(opened)).toBe(false);
    expect(isDirty(edited)).toBe(true);
    expect(located(edited).comment?.name).toBe("Renamed on Ben");
    expect(edited.tree.sections).toHaveLength(ben.sections.length);
    edited.tree.sections.forEach((section, index) => {
      if (index === sectionIndex) expect(section).not.toBe(ben.sections[index]);
      else expect(section).toBe(ben.sections[index]);
    });
  });
});

function located(state: EditorState) {
  return locate(state.tree, state.selection);
}

function idOf(source: EditableTree, sectionName: string, itemName?: string): string {
  const section = source.sections.find((candidate) => candidate.name === sectionName);
  if (!section?.id) throw new Error(`No Section ${sectionName}`);
  if (!itemName) return section.id;
  const item = section.items.find((candidate) => candidate.name === itemName);
  if (!item?.id) throw new Error(`No Item ${sectionName} / ${itemName}`);
  return item.id;
}

function withIds(source: EditableTree): EditableTree {
  return {
    sections: source.sections.map((section, s) => ({
      ...section,
      id: `s${s}`,
      items: section.items.map((item, i) => ({
        ...item,
        id: `s${s}-i${i}`,
        comments: item.comments.map((comment, c) => ({
          ...comment,
          id: `s${s}-i${i}-c${c}`,
        })),
      })),
    })),
  };
}

function retag(source: EditableTree): EditableTree {
  return {
    sections: source.sections.map((section) => ({
      ...section,
      id: `next-${section.id}`,
      items: section.items.map((item) => ({
        ...item,
        id: `next-${item.id}`,
        comments: item.comments.map((comment) => ({
          ...comment,
          id: `next-${comment.id}`,
        })),
      })),
    })),
  };
}
