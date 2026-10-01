import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { EditableTree } from "@/core/import/schemas";
import {
  editorReducer,
  initialEditorState,
  isDirty,
  locate,
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

function open(row: number | null = null, mode: "edit" | "read-only" = "edit"): EditorState {
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
