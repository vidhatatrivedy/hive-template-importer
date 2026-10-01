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
      { fn: "duplicate_template", args: { template_id: UNKNOWN_ID } },
      { fn: "save_version", args: { template_id: UNKNOWN_ID, base_number: 1, tree: { sections: [] } } },
      { fn: "restore_version", args: { version_id: UNKNOWN_ID, base_number: 1 } },
      { fn: "list_templates", args: {} },
      { fn: "create_blank_template", args: { name: "Anon" } },
      { fn: "rename_template", args: { template_id: UNKNOWN_ID, name: "Anon" } },
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

describe("restore version", () => {
  it("restores Version 1 as Version 3 and leaves Version 2 unchanged", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const version1 = await db.getVersionTree(imported.versionId);
      if (!version1) throw new Error("Version 1 was not stored");
      const edits = applySaveEdits(version1);
      const saved = await db.saveVersion(imported.templateId, 1, edits.tree);
      expect(saved).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!saved.ok) return;

      const restored = await db.restoreVersion(imported.versionId, 2);
      expect(restored).toEqual({ ok: true, value: expect.objectContaining({ number: 3 }) });
      if (!restored.ok) return;

      const version3 = await db.getVersionTree(restored.value.versionId);
      const version2 = await db.getVersionTree(saved.value.versionId);
      if (!version3 || !version2) throw new Error("Restored Versions were not readable");

      expect(withoutIds(version3)).toEqual(withoutIds(version1));
      expect(withoutIds(version2)).toEqual(withoutIds(edits.tree));

      const detail = await db.getTemplate(imported.templateId);
      expect(detail?.versions.map((version) => ({
        number: version.number,
        origin: version.origin,
        restoredFromNumber: version.restoredFromNumber,
      }))).toEqual([
        { number: 3, origin: "restore", restoredFromNumber: 1 },
        { number: 2, origin: "save", restoredFromNumber: null },
        { number: 1, origin: "import", restoredFromNumber: null },
      ]);
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("restores the latest Version as an identical next Version", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const version1 = await db.getVersionTree(imported.versionId);
      if (!version1) throw new Error("Version 1 was not stored");

      const restored = await db.restoreVersion(imported.versionId, 1);
      expect(restored).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!restored.ok) return;

      const version2 = await db.getVersionTree(restored.value.versionId);
      if (!version2) throw new Error("Restored Version was not readable");
      expect(withoutIds(version2)).toEqual(withoutIds(version1));

      const detail = await db.getTemplate(imported.templateId);
      expect(detail?.versions.find((version) => version.number === 2)).toMatchObject({
        origin: "restore",
        restoredFromNumber: 1,
      });
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("refuses a Restore on a stale base and writes nothing", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    try {
      const stored = await db.getVersionTree(imported.versionId);
      if (!stored) throw new Error("Version 1 was not stored");
      const saved = await db.saveVersion(imported.templateId, 1, stored);
      expect(saved).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!saved.ok) return;

      const restored = await db.restoreVersion(imported.versionId, 1);
      expect(restored).toEqual({ ok: false, error: { kind: "stale-base", latestNumber: 2 } });

      const detail = await db.getTemplate(imported.templateId);
      expect(detail?.versions.map((version) => version.number)).toEqual([2, 1]);
    } finally {
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("refuses a Restore of an unknown Version", async () => {
    const restored = await db.restoreVersion(UNKNOWN_ID, 1);
    expect(restored).toEqual({ ok: false, error: { kind: "template-not-found" } });
  });
});

describe("template list, blank and rename", () => {
  it("lists Templates by the latest Save, and a Rename does not move one", async () => {
    const older = await db.createBlankTemplate("Older");
    const newer = await db.createBlankTemplate("Newer");
    try {
      const saved = await db.saveVersion(older.templateId, 1, { sections: [] });
      expect(saved.ok).toBe(true);

      const afterSave = await db.listTemplates();
      expect(indexOfId(afterSave, older.templateId)).toBeLessThan(indexOfId(afterSave, newer.templateId));
      const olderBeforeRename = afterSave.find((template) => template.id === older.templateId);
      if (!olderBeforeRename) throw new Error("Blank Template was not listed");

      const renamed = await db.renameTemplate(older.templateId, "Older, renamed");
      expect(renamed).toEqual({ ok: true, value: undefined });

      const afterRename = await db.listTemplates();
      const olderAfterRename = afterRename.find((template) => template.id === older.templateId);
      expect(olderAfterRename?.name).toBe("Older, renamed");
      expect(olderAfterRename?.latest.savedAt).toBe(olderBeforeRename.latest.savedAt);
      expect(indexOfId(afterRename, older.templateId)).toBeLessThan(indexOfId(afterRename, newer.templateId));

      const newerSaved = await db.saveVersion(newer.templateId, 1, { sections: [] });
      expect(newerSaved.ok).toBe(true);
      const afterNewerSave = await db.listTemplates();
      expect(indexOfId(afterNewerSave, newer.templateId)).toBeLessThan(
        indexOfId(afterNewerSave, older.templateId),
      );
    } finally {
      await db.deleteTemplate(older.templateId);
      await db.deleteTemplate(newer.templateId);
    }
  });

  it("reports creation, the copied-from name and the Import run hash for an import, a Blank and a Copy", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    const blank = await db.createBlankTemplate("Built by hand");
    let copyId: string | undefined;
    try {
      const duplicated = await db.duplicateTemplate(imported.templateId);
      expect(duplicated.ok).toBe(true);
      if (!duplicated.ok) return;
      copyId = duplicated.value.templateId;

      const listed = await db.listTemplates();
      expect(listed.find((template) => template.id === imported.templateId)).toMatchObject({
        name: draft.suggestedName,
        creation: "import",
        copiedFromName: null,
        importRun: {
          id: imported.importRunId,
          filename: draft.run.filename,
          sha256: draft.run.sha256,
        },
      });
      expect(listed.find((template) => template.id === blank.templateId)).toMatchObject({
        name: "Built by hand",
        creation: "blank",
        copiedFromName: null,
        importRun: null,
      });
      expect(listed.find((template) => template.id === copyId)).toMatchObject({
        name: `${draft.suggestedName} (copy)`,
        creation: "copy",
        copiedFromName: draft.suggestedName,
        importRun: { id: imported.importRunId, sha256: draft.run.sha256 },
      });

      const sameFile = listed.filter(
        (template) => template.importRun?.sha256 === draft.run.sha256 && template.creation === "import",
      );
      expect(sameFile.map((template) => template.id)).toContain(imported.templateId);
      expect(sameFile.map((template) => template.id)).not.toContain(copyId);

      expect(await db.deleteTemplate(imported.templateId)).toEqual({
        ok: true,
        value: { importRunDeleted: false },
      });
      const afterSourceDeleted = await db.listTemplates();
      expect(afterSourceDeleted.find((template) => template.id === imported.templateId)).toBeUndefined();
      expect(afterSourceDeleted.find((template) => template.id === copyId)).toMatchObject({
        creation: "copy",
        copiedFromName: draft.suggestedName,
        importRun: { sha256: draft.run.sha256 },
      });
    } finally {
      if (copyId) await db.deleteTemplate(copyId);
      await db.deleteTemplate(imported.templateId);
      await db.deleteTemplate(blank.templateId);
    }
  });

  it("stores a Blank Template as an empty Version 1 and deletes no Import run", async () => {
    const blank = await db.createBlankTemplate("  Padded name  ");
    try {
      expect(await db.getVersionTree(blank.versionId)).toEqual({ sections: [] });
      const detail = await db.getTemplate(blank.templateId);
      expect(detail).toMatchObject({
        name: "  Padded name  ",
        creation: "blank",
        copiedFrom: null,
        importRun: null,
        latest: { id: blank.versionId, number: 1 },
      });
      expect(detail?.versions).toEqual([
        expect.objectContaining({
          number: 1,
          origin: "blank",
          counts: { sections: 0, items: 0, comments: 0 },
        }),
      ]);

      const renamed = await db.renameTemplate(blank.templateId, "  Still padded  ");
      expect(renamed.ok).toBe(true);
      expect((await db.getTemplate(blank.templateId))?.name).toBe("  Still padded  ");
    } finally {
      expect(await db.deleteTemplate(blank.templateId)).toEqual({
        ok: true,
        value: { importRunDeleted: false },
      });
      expect(await db.getTemplate(blank.templateId)).toBeNull();
    }
  });

  it("refuses a Source row on a Blank Template", async () => {
    const blank = await db.createBlankTemplate("No file");
    try {
      const saved = await db.saveVersion(blank.templateId, 1, {
        sections: [
          {
            name: "Section",
            items: [
              {
                name: "Item",
                comments: [
                  {
                    name: "Comment",
                    textHtml: "",
                    commentType: "info",
                    category: null,
                    recommendation: null,
                    answerType: "text",
                    defaultBoolean: null,
                    defaultText: null,
                    choiceOptions: [],
                    unitOptions: [],
                    sourceRow: 4,
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(saved).toEqual({
        ok: false,
        error: { kind: "foreign-source-row", rowNumbers: [4] },
      });
      expect((await db.getTemplate(blank.templateId))?.versions.map((version) => version.number)).toEqual([1]);
    } finally {
      await db.deleteTemplate(blank.templateId);
    }
  });

  it("refuses to Rename an unknown Template", async () => {
    expect(await db.renameTemplate(UNKNOWN_ID, "Missing")).toEqual({
      ok: false,
      error: { kind: "template-not-found" },
    });
  });

  it("refuses a blank or space-only name and leaves the Template unchanged", async () => {
    const before = (await db.listTemplates()).map((template) => template.id);
    await expect(db.createBlankTemplate("")).rejects.toMatchObject({ code: "23514" });
    await expect(db.createBlankTemplate("   ")).rejects.toMatchObject({ code: "23514" });
    expect((await db.listTemplates()).map((template) => template.id)).toEqual(before);

    const blank = await db.createBlankTemplate("Kept");
    try {
      await expect(db.renameTemplate(blank.templateId, "")).rejects.toMatchObject({ code: "23514" });
      await expect(db.renameTemplate(blank.templateId, " ")).rejects.toMatchObject({ code: "23514" });
      expect((await db.getTemplate(blank.templateId))?.name).toBe("Kept");
    } finally {
      await db.deleteTemplate(blank.templateId);
    }
  });
});

describe("duplicate template", () => {
  it("refuses to Duplicate an unknown Template", async () => {
    expect(await db.duplicateTemplate(UNKNOWN_ID)).toEqual({
      ok: false,
      error: { kind: "template-not-found" },
    });
  });

  it("copies the source's latest Version and stays independent after Saves and deletion", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    let copyId: string | undefined;
    try {
      const version1 = await db.getVersionTree(imported.versionId);
      if (!version1) throw new Error("Version 1 was not stored");
      const sourceEdits = applySaveEdits(version1);
      const saved = await db.saveVersion(imported.templateId, 1, sourceEdits.tree);
      expect(saved).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!saved.ok) return;

      const latest = await db.getVersionTree(saved.value.versionId);
      if (!latest) throw new Error("Source latest Version was not stored");

      const duplicated = await db.duplicateTemplate(imported.templateId);
      expect(duplicated.ok).toBe(true);
      if (!duplicated.ok) return;
      copyId = duplicated.value.templateId;

      const copyTree = await db.getVersionTree(duplicated.value.versionId);
      if (!copyTree) throw new Error("Copy was not stored");
      expect(withoutIds(copyTree)).toEqual(withoutIds(latest));
      expect(withoutIds(copyTree)).not.toEqual(withoutIds(version1));
      const sourceIds = new Set(collectIds(latest));
      expect(collectIds(copyTree).some((id) => sourceIds.has(id))).toBe(false);

      const copy = await db.getTemplate(copyId);
      expect(copy).toMatchObject({
        name: `${draft.suggestedName} (copy)`,
        creation: "copy",
        copiedFrom: {
          templateId: imported.templateId,
          templateName: draft.suggestedName,
          versionNumber: 2,
        },
        importRun: { id: imported.importRunId },
      });
      expect(copy?.versions).toEqual([
        expect.objectContaining({
          id: duplicated.value.versionId,
          number: 1,
          origin: "copy",
          restoredFromNumber: null,
          counts: countEditableTree(latest),
        }),
      ]);

      const copyEdits = applySaveEdits(copyTree);
      const copySaved = await db.saveVersion(copyId, 1, copyEdits.tree);
      expect(copySaved).toEqual({ ok: true, value: expect.objectContaining({ number: 2 }) });
      if (!copySaved.ok) return;

      const sourceAfterCopySave = await db.getVersionTree(saved.value.versionId);
      if (!sourceAfterCopySave) throw new Error("Source latest Version was not readable");
      expect(withoutIds(sourceAfterCopySave)).toEqual(withoutIds(latest));

      const sourceAgain = applySaveEdits(latest);
      const section = sourceAgain.tree.sections[0];
      if (!section) throw new Error("Fixture has no Section");
      section.name = `${section.name}\u00A0source`;
      const sourceSaved = await db.saveVersion(imported.templateId, 2, sourceAgain.tree);
      expect(sourceSaved).toEqual({ ok: true, value: expect.objectContaining({ number: 3 }) });
      if (!sourceSaved.ok) return;

      const copyVersion1 = await db.getVersionTree(duplicated.value.versionId);
      const copyVersion2 = await db.getVersionTree(copySaved.value.versionId);
      if (!copyVersion1 || !copyVersion2) throw new Error("Copy Versions were not readable");
      expect(withoutIds(copyVersion1)).toEqual(withoutIds(latest));
      expect(withoutIds(copyVersion2)).toEqual(withoutIds(copyEdits.tree));

      const deleted = await db.deleteTemplate(imported.templateId);
      expect(deleted).toEqual({ ok: true, value: { importRunDeleted: false } });
      const copyAfterDelete = await db.getTemplate(copyId);
      expect(copyAfterDelete?.copiedFrom).toEqual({
        templateId: null,
        templateName: draft.suggestedName,
        versionNumber: 2,
      });
      const treeAfter = await db.getVersionTree(duplicated.value.versionId);
      if (!treeAfter) throw new Error("Copy tree was not readable after the source was deleted");
      expect(withoutIds(treeAfter)).toEqual(withoutIds(latest));
      expect(await db.getImportEvidence(imported.importRunId)).toEqual({
        run: draft.run,
        sourceRows: draft.sourceRows,
        issues: draft.issues,
      });
    } finally {
      if (copyId) await db.deleteTemplate(copyId);
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("deletes the Import run only after the last Copy is gone", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    let copyId: string | undefined;
    try {
      const duplicated = await db.duplicateTemplate(imported.templateId);
      expect(duplicated.ok).toBe(true);
      if (!duplicated.ok) return;
      copyId = duplicated.value.templateId;

      const deletedSource = await db.deleteTemplate(imported.templateId);
      expect(deletedSource).toEqual({ ok: true, value: { importRunDeleted: false } });
      expect(await db.getImportEvidence(imported.importRunId)).toEqual({
        run: draft.run,
        sourceRows: draft.sourceRows,
        issues: draft.issues,
      });

      const deletedCopy = await db.deleteTemplate(copyId);
      expect(deletedCopy).toEqual({ ok: true, value: { importRunDeleted: true } });
      expect(await db.getImportEvidence(imported.importRunId)).toBeNull();
    } finally {
      if (copyId) await db.deleteTemplate(copyId);
      await db.deleteTemplate(imported.templateId);
    }
  });

  it("a Copy of a Copy inherits the same Import run", async () => {
    const imported = await db.importTemplate(draft, draft.suggestedName);
    let firstId: string | undefined;
    let secondId: string | undefined;
    try {
      const first = await db.duplicateTemplate(imported.templateId);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      firstId = first.value.templateId;

      const second = await db.duplicateTemplate(firstId);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      secondId = second.value.templateId;

      const detail = await db.getTemplate(second.value.templateId);
      expect(detail).toMatchObject({
        name: `${draft.suggestedName} (copy) (copy)`,
        creation: "copy",
        importRun: { id: imported.importRunId },
        copiedFrom: {
          templateId: first.value.templateId,
          templateName: `${draft.suggestedName} (copy)`,
          versionNumber: 1,
        },
      });

      expect(await db.deleteTemplate(imported.templateId)).toEqual({
        ok: true,
        value: { importRunDeleted: false },
      });
      expect(await db.deleteTemplate(first.value.templateId)).toEqual({
        ok: true,
        value: { importRunDeleted: false },
      });
      const surviving = await db.getTemplate(second.value.templateId);
      expect(surviving?.importRun?.id).toBe(imported.importRunId);
      expect(surviving?.copiedFrom).toEqual({
        templateId: null,
        templateName: `${draft.suggestedName} (copy)`,
        versionNumber: 1,
      });
      expect(await db.getImportEvidence(imported.importRunId)).not.toBeNull();

      expect(await db.deleteTemplate(second.value.templateId)).toEqual({
        ok: true,
        value: { importRunDeleted: true },
      });
      expect(await db.getImportEvidence(imported.importRunId)).toBeNull();
    } finally {
      if (secondId) await db.deleteTemplate(secondId);
      if (firstId) await db.deleteTemplate(firstId);
      await db.deleteTemplate(imported.templateId);
    }
  });
});

function indexOfId(templates: { id: string }[], id: string): number {
  const index = templates.findIndex((template) => template.id === id);
  if (index < 0) throw new Error(`Template ${id} was not listed`);
  return index;
}

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
