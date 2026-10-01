import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { EditableTree } from "@/core/import/schemas";
import { editorReducer, initialEditorState, locate, type EditorState } from "@/app/editor/editor-state";

const FIXTURE = path.resolve(
  __dirname,
  "../../../fixtures/spectora/InterNACHI Residential -2026-09-30.xls",
);

let tree: EditableTree;

beforeAll(async () => {
  const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
  const result = await parseSpectoraExport(bytes, path.basename(FIXTURE));
  if (!result.ok) throw new Error(result.rejection.kind);
  tree = withIds(result.draft.tree);
});

function open(row: number | null = null): EditorState {
  return initialEditorState({ versionId: "version-1", number: 1, tree, row });
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
    const commentId = opened.selection.commentId;
    if (!commentId) throw new Error("expected a Comment");
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
