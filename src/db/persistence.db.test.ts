import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { reconcile, toExportRows } from "@/core/import/reconcile";
import {
  countEditableTree,
  type Comment,
  type EditableTree,
  type ImportDraft,
  type Item,
} from "@/core/import/schemas";
import { createDb, type Db } from "@/db";
import { getDb } from "@/db/server";

const FIXTURE = "InterNACHI Residential -2026-09-30.xls";
const OTHER_FIXTURE = "Radon Inspection-2026-09-30.xls";
const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/spectora");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000001";
/** Tables the migration grants only to `service_role`. */
const TABLES = [
  "templates",
  "versions",
  "sections",
  "items",
  "comments",
  "comment_options",
  "import_runs",
  "source_rows",
  "import_issues",
  "html_cuts",
] as const;

let draft: ImportDraft;
let db: Db;

beforeAll(async () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }
  db = createDb({ url, serviceRoleKey });
  draft = await loadDraft(FIXTURE);
});

describe("persistence tracer", () => {
  it("reads database credentials from the server environment", () => {
    expect(typeof getDb().getTemplate).toBe("function");
  });

  it("reads an imported Template back unchanged", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const evidence = await db.getImportEvidence(imported.importRunId);
      const tree = await db.getVersionTree(imported.versionId);
      if (!evidence || !tree) throw new Error("Import read returned null");
      expect(evidence).toEqual({ run: draft.run, sourceRows: draft.sourceRows, issues: draft.issues });
      expect(withoutIds(tree)).toEqual(withoutIds(draft.tree));

      const result = reconcile(evidence, tree);
      expect(result.unexplained).toBe(0);
      expect(result.verified).toBe(result.total);

      const exported = toExportRows(tree, evidence);
      expect(exported.map((row) => row.sourceRow)).toEqual(evidence.sourceRows.map((row) => row.rowNumber));
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("returns the Template header and Version 1 from the import", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const detail = await db.getTemplate(imported.templateId);
      if (!detail) throw new Error("Imported Template was not found");
      expect(detail).toMatchObject({
        id: imported.templateId,
        name: draft.suggestedName,
        creation: "import",
        copiedFrom: null,
        importRun: {
          id: imported.importRunId,
          filename: draft.run.filename,
          sha256: draft.run.sha256,
          byteSize: draft.run.byteSize,
        },
        latest: { id: imported.versionId, number: 1 },
      });
      expect(detail.versions).toEqual([
        expect.objectContaining({
          id: imported.versionId,
          number: 1,
          origin: "import",
          restoredFromNumber: null,
          counts: countEditableTree(draft.tree),
        }),
      ]);
      expect(detail.createdAt.length).toBeGreaterThan(0);
      expect(detail.importRun?.importedAt.length).toBeGreaterThan(0);
      expect(detail.latest.savedAt).toBe(detail.versions[0]?.savedAt);
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("returns null for an unknown Template, Version and Import run", async () => {
    expect(await db.getTemplate(UNKNOWN_ID)).toBeNull();
    expect(await db.getVersionTree(UNKNOWN_ID)).toBeNull();
    expect(await db.getImportEvidence(UNKNOWN_ID)).toBeNull();
  });

  it("removes the Import run when the imported Template is deleted", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    const deleted = await db.deleteTemplate(imported.templateId);
    expect(deleted).toEqual({ ok: true, value: { importRunDeleted: true } });
    expect(await db.getImportEvidence(imported.importRunId)).toBeNull();
    expect(await db.getTemplate(imported.templateId)).toBeNull();
    expect(await db.deleteTemplate(UNKNOWN_ID)).toEqual({ ok: false, error: { kind: "template-not-found" } });
  });

  it("a publishable key cannot read tables or call functions", async (context) => {
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!key || !url) {
      console.log("Skipping grants check: SUPABASE_PUBLISHABLE_KEY is not set");
      context.skip();
      return;
    }

    const anon = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    for (const table of TABLES) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(seesNothing(data, error), table).toBe(true);
    }

    const calls = [
      { fn: "import_template", args: { payload: {} } },
      { fn: "get_template", args: { template_id: UNKNOWN_ID } },
      { fn: "get_version_tree", args: { version_id: UNKNOWN_ID } },
      { fn: "get_import_evidence", args: { import_run_id: UNKNOWN_ID } },
      { fn: "delete_template", args: { template_id: UNKNOWN_ID } },
      { fn: "save_version", args: { template_id: UNKNOWN_ID, base_number: 1, tree: { sections: [] } } },
    ];
    for (const call of calls) {
      const { data, error } = await anon.rpc(call.fn, call.args);
      expect(seesNothing(data, error), call.fn).toBe(true);
    }
  });
});

describe("save version", () => {
  it("stores one Save as Version 2 and leaves Version 1 unchanged", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const stored = await db.getVersionTree(imported.versionId);
      if (!stored) throw new Error("Version 1 was not stored");
      const edits = applySaveEdits(stored);

      const saved = await db.saveVersion(imported.templateId, 1, edits.tree);
      expect(saved).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!saved.ok) return;

      const version2 = await db.getVersionTree(saved.value.versionId);
      const version1 = await db.getVersionTree(imported.versionId);
      if (!version2 || !version1) throw new Error("Saved Versions were not readable");

      expect(withoutIds(version2)).toEqual(withoutIds(edits.tree));
      expect(withoutIds(version1)).toEqual(withoutIds(stored));
      const submittedIds = new Set(collectIds(edits.tree));
      expect(collectIds(version2).some((id) => submittedIds.has(id))).toBe(false);

      const edited = findComment(version2, (comment) => comment.sourceRow === edits.editedSourceRow);
      expect(edited?.sourceRow).toBe(edits.editedSourceRow);
      expect(edited?.textHtml).toBe(edits.editedTextHtml);

      const untouched = findComment(version2, (comment) => comment.sourceRow === edits.untouchedSourceRow);
      expect(untouched && omitId(untouched)).toEqual(edits.untouched);

      const detail = await db.getTemplate(imported.templateId);
      expect(detail?.latest).toMatchObject({ id: saved.value.versionId, number: 2 });
      expect(detail?.versions.map((version) => ({
        number: version.number,
        origin: version.origin,
        counts: version.counts,
      }))).toEqual([
        { number: 2, origin: "save", counts: countEditableTree(edits.tree) },
        { number: 1, origin: "import", counts: countEditableTree(stored) },
      ]);
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("refuses a second Save on the same base and writes nothing", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const stored = await db.getVersionTree(imported.versionId);
      if (!stored) throw new Error("Version 1 was not stored");
      const first = await db.saveVersion(imported.templateId, 1, stored);
      expect(first).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!first.ok) return;

      const changed = structuredClone(stored);
      const section = changed.sections[0];
      if (!section) throw new Error("Fixture has no Section");
      section.name = `${section.name} stale`;

      const second = await db.saveVersion(imported.templateId, 1, changed);
      expect(second).toEqual({ ok: false, error: { kind: "stale-base", latestNumber: 2 } });

      const detail = await db.getTemplate(imported.templateId);
      expect(detail?.versions.map((version) => version.number)).toEqual([2, 1]);
      const version2 = await db.getVersionTree(first.value.versionId);
      if (!version2) throw new Error("Version 2 was not stored");
      expect(withoutIds(version2)).toEqual(withoutIds(stored));
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("refuses a Source row that belongs to another Template's Import run", async () => {
    const targetDraft = await loadDraft(OTHER_FIXTURE);
    const targetRows = new Set(targetDraft.sourceRows.map((row) => row.rowNumber));
    const foreignRow = draft.sourceRows.find((row) => !targetRows.has(row.rowNumber))?.rowNumber;
    if (foreignRow == null) throw new Error("No Source row belongs only to the other fixture");

    const owner = await db.importTemplate(draft, draft.suggestedName);
    const target = await db.importTemplate(targetDraft, targetDraft.suggestedName);
    try {
      const stored = await db.getVersionTree(target.versionId);
      const comment = firstComment(stored);
      if (!stored || !comment) throw new Error("Target Version 1 has no Comment");
      comment.sourceRow = foreignRow;

      const saved = await db.saveVersion(target.templateId, 1, stored);
      expect(saved).toEqual({
        ok: false,
        error: { kind: "foreign-source-row", rowNumbers: [foreignRow] },
      });
      const detail = await db.getTemplate(target.templateId);
      expect(detail?.versions.map((version) => version.number)).toEqual([1]);
    } finally {
      await db.deleteTemplate(target.templateId);
      await db.deleteTemplate(owner.templateId);
    }
  });

  it("refuses a Save for an unknown Template", async () => {
    const saved = await db.saveVersion(UNKNOWN_ID, 1, draft.tree);
    expect(saved).toEqual({ ok: false, error: { kind: "template-not-found" } });
  });

  it("allows a name-only Template update and refuses content updates", async () => {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    const service = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const stored = await db.getVersionTree(imported.versionId);
      const comment = firstComment(stored);
      const sourceRow = draft.sourceRows[0];
      if (!stored || !comment?.id || !sourceRow) throw new Error("Imported Template has nothing to update");
      const before = await db.getTemplate(imported.templateId);
      if (!before?.importRun) throw new Error("Imported Template has no Import run");

      const renamed = await service.from("templates").update({ name: "Renamed for the trigger check" }).eq("id", imported.templateId);
      expect(renamed.error).toBeNull();
      expect((await db.getTemplate(imported.templateId))?.name).toBe("Renamed for the trigger check");

      const retargeted = await service.from("templates").update({ import_run_id: null }).eq("id", imported.templateId);
      expect(retargeted.error).toBeTruthy();
      expect((await db.getTemplate(imported.templateId))?.importRun?.id).toBe(before.importRun.id);

      const commentUpdate = await service.from("comments").update({ text_html: "changed by a direct update" }).eq("id", comment.id);
      expect(commentUpdate.error).toBeTruthy();
      const afterComment = await db.getVersionTree(imported.versionId);
      expect(findComment(afterComment, (storedComment) => storedComment.id === comment.id)?.textHtml).toBe(
        comment.textHtml,
      );

      const versionUpdate = await service
        .from("versions")
        .update({ created_at: "2000-01-01T00:00:00.000Z" })
        .eq("id", imported.versionId);
      expect(versionUpdate.error).toBeTruthy();
      expect((await db.getTemplate(imported.templateId))?.latest.savedAt).toBe(before.latest.savedAt);

      const sourceUpdate = await service
        .from("source_rows")
        .update({ cells: ["changed by a direct update"] })
        .eq("import_run_id", imported.importRunId)
        .eq("row_number", sourceRow.rowNumber);
      expect(sourceUpdate.error).toBeTruthy();
      const evidence = await db.getImportEvidence(imported.importRunId);
      expect(evidence?.sourceRows.find((row) => row.rowNumber === sourceRow.rowNumber)?.cells).toEqual(sourceRow.cells);
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });
});

function seesNothing(data: unknown, error: { message: string } | null): boolean {
  if (error) return true;
  if (data == null) return true;
  return Array.isArray(data) && data.length === 0;
}

function omitId<T extends { id?: string }>(value: T): Omit<T, "id"> {
  const copy = { ...value };
  delete copy.id;
  return copy;
}

function withoutIds(tree: EditableTree): EditableTree {
  return {
    sections: tree.sections.map((section) => ({
      name: section.name,
      items: section.items.map((item) => ({
        name: item.name,
        comments: item.comments.map(omitId),
      })),
    })),
  };
}

async function loadDraft(filename: string): Promise<ImportDraft> {
  const bytes = fs.readFileSync(path.join(FIXTURE_DIR, filename));
  const parsed = await parseSpectoraExport(bytes, filename);
  if (!parsed.ok) throw new Error(`Fixture was rejected: ${parsed.rejection.kind}`);
  return parsed.draft;
}

function applySaveEdits(original: EditableTree) {
  const tree = structuredClone(original);
  const section = tree.sections[0];
  if (!section) throw new Error("Fixture has no Section");
  section.name = `${section.name}\u00A0`;

  const moveItem = findItem(tree, (item) => item.comments.length >= 2 && item.comments[0]?.sourceRow != null);
  if (!moveItem) throw new Error("Fixture has no Item with two Comments");
  const edited = moveItem.comments[0];
  const displaced = moveItem.comments[1];
  if (!edited || edited.sourceRow == null || !displaced) throw new Error("Edited Comment has no Source row");
  const editedSourceRow = edited.sourceRow;
  const editedTextHtml = `${edited.textHtml}\u00A0`;
  edited.textHtml = editedTextHtml;
  moveItem.comments.splice(0, 2, displaced, edited);

  const optionComment = findComment(tree, (comment) => comment.choiceOptions.length > 0);
  if (!optionComment) throw new Error("Fixture has no choice list");
  optionComment.choiceOptions = [...optionComment.choiceOptions, " extra option "];

  const deleteItem = findItem(
    tree,
    (item) => item !== moveItem && !item.comments.some((comment) => comment === optionComment),
  );
  if (!deleteItem) throw new Error("Fixture has no other Item to delete");
  for (const candidate of tree.sections) {
    const index = candidate.items.indexOf(deleteItem);
    if (index >= 0) {
      candidate.items.splice(index, 1);
      break;
    }
  }

  moveItem.comments.push({
    name: "Added during Save",
    textHtml: "",
    commentType: "info",
    category: null,
    recommendation: null,
    answerType: "text",
    defaultBoolean: null,
    defaultText: null,
    choiceOptions: [],
    unitOptions: [],
    sourceRow: null,
  });

  const deletedRows = new Set(
    deleteItem.comments.flatMap((comment) => (comment.sourceRow == null ? [] : [comment.sourceRow])),
  );
  const untouched = findComment(
    original,
    (comment) =>
      comment.sourceRow != null &&
      comment.sourceRow !== editedSourceRow &&
      comment.sourceRow !== optionComment.sourceRow &&
      !deletedRows.has(comment.sourceRow),
  );
  if (!untouched || untouched.sourceRow == null) throw new Error("Fixture has no untouched Comment");

  return {
    tree,
    editedSourceRow,
    editedTextHtml,
    untouchedSourceRow: untouched.sourceRow,
    untouched: omitId(untouched),
  };
}

function findItem(tree: EditableTree, predicate: (item: Item) => boolean): Item | undefined {
  for (const section of tree.sections) {
    for (const item of section.items) {
      if (predicate(item)) return item;
    }
  }
  return undefined;
}

function firstComment(tree: EditableTree | null): Comment | undefined {
  return tree?.sections[0]?.items[0]?.comments[0];
}

function findComment(
  tree: EditableTree | null,
  predicate: (comment: Comment) => boolean,
): Comment | undefined {
  if (!tree) return undefined;
  for (const section of tree.sections) {
    for (const item of section.items) {
      for (const comment of item.comments) {
        if (predicate(comment)) return comment;
      }
    }
  }
  return undefined;
}

function collectIds(tree: EditableTree): string[] {
  const ids: string[] = [];
  for (const section of tree.sections) {
    if (section.id) ids.push(section.id);
    for (const item of section.items) {
      if (item.id) ids.push(item.id);
      for (const comment of item.comments) {
        if (comment.id) ids.push(comment.id);
      }
    }
  }
  return ids;
}
