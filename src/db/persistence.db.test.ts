import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { reconcile, toExportRows } from "@/core/import/reconcile";
import { countEditableTree, type EditableTree, type ImportDraft } from "@/core/import/schemas";
import { createDb, type Db } from "@/db";
import { getDb } from "@/db/server";

const FIXTURE = "InterNACHI Residential -2026-09-30.xls";
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

  const bytes = fs.readFileSync(path.join(FIXTURE_DIR, FIXTURE));
  const parsed = await parseSpectoraExport(bytes, FIXTURE);
  if (!parsed.ok) throw new Error(`Fixture was rejected: ${parsed.rejection.kind}`);
  draft = parsed.draft;
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
    ];
    for (const call of calls) {
      const { data, error } = await anon.rpc(call.fn, call.args);
      expect(seesNothing(data, error), call.fn).toBe(true);
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
