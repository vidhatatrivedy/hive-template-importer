import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { editableTreeSchema, importDraftSchema } from "@/core/import/schemas";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

function comment(overrides: Record<string, unknown> = {}) {
  return {
    sourceRow: 2,
    name: "Shingles",
    textHtml: "<p>Checked</p>",
    commentType: "info",
    category: null,
    recommendation: null,
    answerType: "boolean",
    defaultBoolean: null,
    defaultText: null,
    choiceOptions: [],
    unitOptions: [],
    ...overrides,
  };
}

function treeWith(commentOverrides: Record<string, unknown>) {
  return {
    sections: [
      {
        name: "Roof",
        items: [{ name: "Covering", comments: [comment(commentOverrides)] }],
      },
    ],
  };
}

describe("editable tree schema", () => {
  it("validates every HTML fixture draft and its tree", async () => {
    const files = fs.readdirSync(FIXTURE_DIR).filter((file) => file.endsWith(".xls") && !file.includes("(plain text)"));
    for (const file of files) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, file)));
      const result = await parseSpectoraExport(bytes, file);
      expect(result.ok, file).toBe(true);
      if (!result.ok) continue;
      const draft = importDraftSchema.safeParse(result.draft);
      const tree = editableTreeSchema.safeParse(result.draft.tree);
      expect(draft.success, draft.success ? file : JSON.stringify(draft.error.issues)).toBe(true);
      expect(tree.success, tree.success ? file : JSON.stringify(tree.error.issues)).toBe(true);
    }
  });

  it("refuses a blank name, an unknown Comment type, a Category of 2, and a non-array option list", () => {
    expect(editableTreeSchema.safeParse({ sections: [{ name: "   ", items: [] }] }).success).toBe(false);
    expect(editableTreeSchema.safeParse(treeWith({ name: "" })).success).toBe(false);
    expect(editableTreeSchema.safeParse(treeWith({ commentType: "note" })).success).toBe(false);
    expect(editableTreeSchema.safeParse(treeWith({ category: 2 })).success).toBe(false);
    expect(editableTreeSchema.safeParse(treeWith({ choiceOptions: "Yes, No" })).success).toBe(false);
  });

  it("accepts an empty Section and duplicate names", () => {
    const duplicate = comment();
    const parsed = editableTreeSchema.safeParse({
      sections: [
        { name: "Roof", items: [] },
        {
          name: "Roof",
          items: [
            { name: "Covering", comments: [duplicate, { ...duplicate, sourceRow: 3 }] },
            { name: "Covering", comments: [] },
          ],
        },
      ],
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});
