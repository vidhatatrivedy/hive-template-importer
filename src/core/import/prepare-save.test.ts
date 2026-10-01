import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cutKinds, type Cut, type CutKind } from "@/core/sanitise";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { Comment, EditableTree } from "@/core/import/schemas";
import { prepareSave, summariseCuts } from "@/core/import/prepare-save";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

function htmlFixtures(): string[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".xls") && !file.includes("plain text"))
    .sort();
}

async function draftTree(file: string): Promise<EditableTree> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft.tree;
}

/** The spec's expected tree: the same nodes, with every editor id removed. */
function withoutIds(tree: EditableTree): EditableTree {
  return {
    sections: tree.sections.map((section) => ({
      name: section.name,
      items: section.items.map((item) => ({
        name: item.name,
        comments: item.comments.map((comment) => ({
          sourceRow: comment.sourceRow,
          name: comment.name,
          textHtml: comment.textHtml,
          commentType: comment.commentType,
          category: comment.category,
          recommendation: comment.recommendation,
          answerType: comment.answerType,
          defaultBoolean: comment.defaultBoolean,
          defaultText: comment.defaultText,
          choiceOptions: comment.choiceOptions,
          unitOptions: comment.unitOptions,
        })),
      })),
    })),
  };
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    sourceRow: 2,
    name: "Flashing",
    textHtml: "<p>Kept</p>",
    commentType: "info",
    category: null,
    recommendation: "Repair",
    answerType: "checkbox",
    defaultBoolean: true,
    defaultText: "kept",
    choiceOptions: ["Yes"],
    unitOptions: ["ft"],
    ...overrides,
  };
}

function treeOf(sections: EditableTree["sections"]): EditableTree {
  return { sections };
}

describe("prepareSave", () => {
  it("leaves every HTML fixture's draft tree unchanged, apart from ids", async () => {
    const files = htmlFixtures();
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      const tree = await draftTree(file);
      expect(prepareSave(tree), file).toEqual({ ok: true, tree: withoutIds(tree), changes: [] });
    }
  });

  it("trims names, Recommendation, defaults and options, and drops empty option entries", () => {
    const original = treeOf([
      {
        id: "section-1",
        name: " \u00A0Roof\u00A0 ",
        items: [
          {
            id: "item-1",
            name: " Gutters ",
            comments: [
              comment({
                id: "comment-1",
                name: " \u00A0Flashing ",
                recommendation: " \u00A0Repair\u00A0 ",
                defaultText: "  note\u00A0",
                choiceOptions: [" a ", "", "\u00A0", "b ", "  "],
                unitOptions: [" ft ", " "],
              }),
              comment({
                name: "Clear",
                recommendation: null,
                defaultText: null,
                choiceOptions: [],
                unitOptions: [],
                answerType: "text",
                defaultBoolean: null,
              }),
            ],
          },
        ],
      },
    ]);

    const prepared = prepareSave(original);

    expect(prepared).toEqual({
      ok: true,
      changes: [],
      tree: {
        sections: [
          {
            name: "Roof",
            items: [
              {
                name: "Gutters",
                comments: [
                  comment({
                    name: "Flashing",
                    recommendation: "Repair",
                    defaultText: "note",
                    choiceOptions: ["a", "b"],
                    unitOptions: ["ft"],
                  }),
                  comment({
                    name: "Clear",
                    recommendation: null,
                    defaultText: null,
                    choiceOptions: [],
                    unitOptions: [],
                    answerType: "text",
                    defaultBoolean: null,
                  }),
                ],
              },
            ],
          },
        ],
      },
    });
    expect(original.sections[0]?.name).toBe(" \u00A0Roof\u00A0 ");
    expect(prepared.ok && prepared.tree.sections[0]).not.toHaveProperty("id");
    expect(prepared.ok && prepared.tree.sections[0]?.items[0]).not.toHaveProperty("id");
    expect(prepared.ok && prepared.tree.sections[0]?.items[0]?.comments[0]).not.toHaveProperty("id");
  });

  it("turns a whitespace Recommendation or default into null", () => {
    const prepared = prepareSave(
      treeOf([
        {
          name: "Roof",
          items: [
            {
              name: "Gutters",
              comments: [comment({ recommendation: " \u00A0 ", defaultText: "  " })],
            },
          ],
        },
      ]),
    );

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.tree.sections[0]?.items[0]?.comments[0]).toMatchObject({
      recommendation: null,
      defaultText: null,
    });
    expect(prepared.changes).toEqual([]);
  });

  it("reports every blank name with its level and index path", () => {
    const prepared = prepareSave(
      treeOf([
        {
          name: "  ",
          items: [
            {
              name: "Gutters",
              comments: [comment({ name: "Flashing" })],
            },
          ],
        },
        {
          name: "Electrical",
          items: [
            {
              name: "\u00A0",
              comments: [comment({ name: "Panel" })],
            },
            {
              name: "Outlets",
              comments: [comment({ name: "Kept" }), comment({ name: "" })],
            },
          ],
        },
      ]),
    );

    expect(prepared).toEqual({
      ok: false,
      blank: [
        { level: "section", path: [0] },
        { level: "item", path: [1, 0] },
        { level: "comment", path: [1, 1, 1] },
      ],
    });
  });

  it("sanitises an edited Comment, reports the cuts, and changes nothing the second time", () => {
    const textHtml =
      '<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://example.org/page?a=1&amp;b=2" width="5"></iframe>';
    const prepared = prepareSave(
      treeOf([
        {
          name: "Roof",
          items: [
            {
              name: "Gutters",
              comments: [comment({ name: " Crack ", sourceRow: 12, textHtml })],
            },
          ],
        },
      ]),
    );

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.tree.sections[0]?.items[0]?.comments[0]?.textHtml).toBe(
      '<p>Hi</p><a href="https://example.org/page?a=1&amp;b=2">https://example.org/page?a=1&amp;b=2</a>',
    );
    expect(prepared.tree.sections[0]?.items[0]?.comments[0]?.name).toBe("Crack");
    expect(
      prepared.changes.map((change) => ({
        path: change.path,
        name: change.name,
        sourceRow: change.sourceRow,
        summary: change.summary,
      })),
    ).toEqual([
      {
        path: [0, 0, 0],
        name: "Crack",
        sourceRow: 12,
        summary: [
          "1 attribute removed: `onclick`",
          "1 tag removed with its content: `<script>`",
          "1 iframe turned into a link",
        ],
      },
    ]);
    expect(prepared.changes[0]?.cuts.map((cut) => cut.kind)).toEqual([
      "attribute-removed",
      "tag-removed",
      "iframe-to-link",
    ]);

    expect(prepareSave(prepared.tree)).toEqual({ ok: true, tree: prepared.tree, changes: [] });
  });
});

describe("Ben's draft tree", () => {
  it("serialises to under 4 MB", async () => {
    const file = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";
    const tree = await draftTree(file);
    expect(Buffer.byteLength(JSON.stringify(tree), "utf8")).toBeLessThan(4 * 1024 * 1024);
  });
});

function cut(kind: CutKind, context: Cut["context"]): Cut {
  return { start: 0, end: 0, kind, removedText: "", context };
}

describe("summariseCuts", () => {
  it("words the spec's examples, grouping by kind in the order the cuts appear", () => {
    expect(
      summariseCuts([
        cut("tag-removed", { tag: "script" }),
        cut("attribute-removed", { tag: "p", attribute: "onclick" }),
        cut("attribute-removed", { tag: "span", attribute: "class" }),
        cut("css-property-removed", { tag: "div", property: "position" }),
        cut("iframe-to-link", { tag: "iframe" }),
        cut("link-scheme-removed", { tag: "a" }),
        cut("markup-rebuilt", { tag: "div" }),
      ]),
    ).toEqual([
      "1 tag removed with its content: `<script>`",
      "2 attributes removed: `onclick`, `class`",
      "1 style property removed: `position`",
      "1 iframe turned into a link",
      "1 link address removed (unsafe scheme)",
      "Markup rebuilt",
    ]);
  });

  it("uses singular and plural forms, and lists each tag, attribute or property once", () => {
    expect(summariseCuts([cut("tag-removed", { tag: "script" }), cut("tag-removed", { tag: "script" }), cut("tag-removed", { tag: "style" })])).toEqual([
      "3 tags removed with their content: `<script>`, `<style>`",
    ]);
    expect(summariseCuts([cut("attribute-removed", { tag: "p", attribute: "onclick" })])).toEqual([
      "1 attribute removed: `onclick`",
    ]);
    expect(
      summariseCuts([
        cut("css-property-removed", { tag: "div", property: "position" }),
        cut("css-property-removed", { tag: "div", property: "z-index" }),
      ]),
    ).toEqual(["2 style properties removed: `position`, `z-index`"]);
    expect(summariseCuts([cut("iframe-to-link", { tag: "iframe" }), cut("iframe-to-link", { tag: "iframe" })])).toEqual([
      "2 iframes turned into links",
    ]);
    expect(summariseCuts([cut("link-scheme-removed", { tag: "a" }), cut("link-scheme-removed", { tag: "img" })])).toEqual([
      "2 link addresses removed (unsafe scheme)",
    ]);
    expect(summariseCuts([cut("markup-rebuilt", { tag: "div" }), cut("markup-rebuilt", { tag: "div" })])).toEqual([
      "Markup rebuilt",
    ]);
    expect(summariseCuts([cut("editor-leftover", { tag: "p", attribute: "class" })])).toEqual([
      "1 editor leftover removed: `class`",
    ]);
    expect(
      summariseCuts([
        cut("editor-leftover", { tag: "p", attribute: "class" }),
        cut("editor-leftover", { tag: "p", attribute: "data-foo" }),
      ]),
    ).toEqual(["2 editor leftovers removed: `class`, `data-foo`"]);
    expect(summariseCuts([cut("tag-unwrapped", { tag: "font" })])).toEqual(["1 tag unwrapped: `<font>`"]);
    expect(summariseCuts([cut("tag-unwrapped", { tag: "font" }), cut("tag-unwrapped", { tag: "center" })])).toEqual([
      "2 tags unwrapped: `<font>`, `<center>`",
    ]);
    expect(summariseCuts([cut("style-unparseable", { tag: "p" })])).toEqual(["1 unparseable style removed: `<p>`"]);
    expect(summariseCuts([cut("style-unparseable", { tag: "p" }), cut("style-unparseable", { tag: "div" })])).toEqual([
      "2 unparseable styles removed: `<p>`, `<div>`",
    ]);
    expect(summariseCuts([cut("youtube-wrapper-emptied", { tag: "div" })])).toEqual(["1 empty YouTube wrapper removed"]);
    expect(
      summariseCuts([cut("youtube-wrapper-emptied", { tag: "div" }), cut("youtube-wrapper-emptied", { tag: "div" })]),
    ).toEqual(["2 empty YouTube wrappers removed"]);
  });

  it("gives every cut kind a non-empty line", () => {
    const contextFor: Record<CutKind, Cut["context"]> = {
      "editor-leftover": { tag: "p", attribute: "class" },
      "attribute-removed": { tag: "p", attribute: "onclick" },
      "css-property-removed": { tag: "div", property: "position" },
      "style-unparseable": { tag: "p" },
      "tag-removed": { tag: "script" },
      "tag-unwrapped": { tag: "font" },
      "link-scheme-removed": { tag: "a" },
      "iframe-to-link": { tag: "iframe" },
      "youtube-wrapper-emptied": { tag: "div" },
      "markup-rebuilt": { tag: "div" },
    };
    expect(cutKinds).toHaveLength(Object.keys(contextFor).length);
    for (const kind of cutKinds) {
      const lines = summariseCuts([cut(kind, contextFor[kind])]);
      expect(lines, kind).toHaveLength(1);
      expect(lines[0]?.trim().length, kind).toBeGreaterThan(0);
    }
    expect(summariseCuts([])).toEqual([]);
  });
});
