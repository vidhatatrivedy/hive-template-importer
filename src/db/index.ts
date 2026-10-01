import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { catalogueEntry, type IssueClass, type IssueSeverity } from "@/core/import/catalogue";
import {
  editableTreeSchema,
  importEvidenceSchema,
  type EditableTree,
  type ImportDraft,
  type ImportEvidence,
  type ImportIssue,
} from "@/core/import/schemas";
import {
  deleteTemplateResultSchema,
  duplicateTemplateResultSchema,
  importTemplateResultSchema,
  restoreVersionResultSchema,
  saveVersionResultSchema,
  templateDetailSchema,
  type DbRefusal,
  type DeleteTemplateResult,
  type DuplicateTemplateResult,
  type ImportTemplateResult,
  type RestoreVersionResult,
  type Result,
  type SaveVersionResult,
  type TemplateDetail,
} from "@/db/schemas";

export type {
  DbRefusal,
  DeleteTemplateResult,
  DuplicateTemplateResult,
  ImportTemplateResult,
  RestoreVersionResult,
  Result,
  SaveVersionResult,
  TemplateDetail,
  VersionOrigin,
} from "@/db/schemas";
export { templateDetailSchema, versionOrigins } from "@/db/schemas";

/** PT* SQLSTATEs the write functions raise. Mapped from the JSON detail, never from the message. */
const TEMPLATE_NOT_FOUND = "PT404";
const STALE_BASE = "PT409";
const FOREIGN_SOURCE_ROW = "PT422";
/** Postgres `unique_violation` on `versions (template_id, number)`, the race backstop. */
const UNIQUE_VIOLATION = "23505";
const VERSION_NUMBER_CONSTRAINT = "versions_template_id_number_key";
const VERSION_NUMBER_COLUMNS = "(template_id, number)";

export interface Db {
  importTemplate(draft: ImportDraft, name: string): Promise<ImportTemplateResult>;
  deleteTemplate(templateId: string): Promise<Result<DeleteTemplateResult>>;
  duplicateTemplate(templateId: string): Promise<Result<DuplicateTemplateResult>>;
  saveVersion(
    templateId: string,
    baseNumber: number,
    tree: EditableTree,
  ): Promise<Result<SaveVersionResult>>;
  restoreVersion(versionId: string, baseNumber: number): Promise<Result<RestoreVersionResult>>;
  getTemplate(templateId: string): Promise<TemplateDetail | null>;
  getVersionTree(versionId: string): Promise<EditableTree | null>;
  getImportEvidence(importRunId: string): Promise<ImportEvidence | null>;
}

export function createDb(env: { url: string; serviceRoleKey: string }): Db {
  const client = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    importTemplate: (draft, name) => importTemplate(client, draft, name),
    deleteTemplate: (templateId) => deleteTemplate(client, templateId),
    duplicateTemplate: (templateId) => duplicateTemplate(client, templateId),
    saveVersion: (templateId, baseNumber, tree) => saveVersion(client, templateId, baseNumber, tree),
    restoreVersion: (versionId, baseNumber) => restoreVersion(client, versionId, baseNumber),
    getTemplate: (templateId) =>
      readOne(client, "get_template", { template_id: templateId }, templateDetailSchema),
    getVersionTree: (versionId) =>
      readOne(client, "get_version_tree", { version_id: versionId }, editableTreeSchema),
    getImportEvidence: (importRunId) =>
      readOne(client, "get_import_evidence", { import_run_id: importRunId }, importEvidenceSchema),
  };
}

async function importTemplate(client: SupabaseClient, draft: ImportDraft, name: string) {
  const data = await call(client, "import_template", {
    payload: {
      name,
      evidence: {
        run: draft.run,
        sourceRows: draft.sourceRows,
        issues: draft.issues.map(withSeverityAndClass),
      },
      tree: draft.tree,
    },
  });
  return importTemplateResultSchema.parse(data);
}

async function duplicateTemplate(
  client: SupabaseClient,
  templateId: string,
): Promise<Result<DuplicateTemplateResult>> {
  const { data, error } = await client.rpc("duplicate_template", { template_id: templateId });
  if (error) {
    const refusal = refusalFrom(error);
    if (refusal) return { ok: false, error: refusal };
    throw error;
  }
  return { ok: true, value: duplicateTemplateResultSchema.parse(data) };
}

async function deleteTemplate(
  client: SupabaseClient,
  templateId: string,
): Promise<Result<DeleteTemplateResult>> {
  const { data, error } = await client.rpc("delete_template", { template_id: templateId });
  if (error) {
    const refusal = refusalFrom(error);
    if (refusal) return { ok: false, error: refusal };
    throw error;
  }
  return { ok: true, value: deleteTemplateResultSchema.parse(data) };
}

async function saveVersion(
  client: SupabaseClient,
  templateId: string,
  baseNumber: number,
  tree: EditableTree,
): Promise<Result<SaveVersionResult>> {
  const { data, error } = await client.rpc("save_version", {
    template_id: templateId,
    base_number: baseNumber,
    tree,
  });
  if (error) {
    const refusal = refusalFrom(error) ?? staleBaseFromVersionConflict(error, baseNumber);
    if (refusal) return { ok: false, error: refusal };
    throw error;
  }
  return { ok: true, value: saveVersionResultSchema.parse(data) };
}

async function restoreVersion(
  client: SupabaseClient,
  versionId: string,
  baseNumber: number,
): Promise<Result<RestoreVersionResult>> {
  const { data, error } = await client.rpc("restore_version", {
    version_id: versionId,
    base_number: baseNumber,
  });
  if (error) {
    const refusal = refusalFrom(error) ?? staleBaseFromVersionConflict(error, baseNumber);
    if (refusal) return { ok: false, error: refusal };
    throw error;
  }
  return { ok: true, value: restoreVersionResultSchema.parse(data) };
}

async function readOne<T>(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const data = await call(client, functionName, args);
  if (data === null) return null;
  return schema.parse(data);
}

async function call(
  client: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw error;
  return data;
}

function withSeverityAndClass(
  issue: ImportIssue,
): ImportIssue & { severity: IssueSeverity; class: IssueClass } {
  const entry = catalogueEntry(issue.kind);
  return { ...issue, severity: entry.severity, class: entry.class };
}

const staleBaseDetailSchema = z.object({
  latestNumber: z.number().int().positive(),
});

const foreignSourceRowDetailSchema = z.object({
  rowNumbers: z.array(z.number().int()),
});

function refusalFrom(error: PostgrestError): DbRefusal | null {
  if (error.code === TEMPLATE_NOT_FOUND) return { kind: "template-not-found" };
  if (error.code === STALE_BASE) {
    const detail = staleBaseDetailSchema.safeParse(parseDetail(error));
    if (!detail.success) return null;
    return { kind: "stale-base", latestNumber: detail.data.latestNumber };
  }
  if (error.code === FOREIGN_SOURCE_ROW) {
    const detail = foreignSourceRowDetailSchema.safeParse(parseDetail(error));
    if (!detail.success) return null;
    return { kind: "foreign-source-row", rowNumbers: detail.data.rowNumbers };
  }
  return null;
}

function staleBaseFromVersionConflict(error: PostgrestError, baseNumber: number): DbRefusal | null {
  if (!isVersionNumberConflict(error)) return null;
  return { kind: "stale-base", latestNumber: baseNumber + 1 };
}

function parseDetail(error: PostgrestError): unknown {
  if (!error.details) return null;
  try {
    return JSON.parse(error.details);
  } catch {
    return null;
  }
}

function isVersionNumberConflict(error: PostgrestError): boolean {
  if (error.code !== UNIQUE_VIOLATION) return false;
  const text = `${error.message} ${error.details}`;
  return text.includes(VERSION_NUMBER_CONSTRAINT) || text.includes(VERSION_NUMBER_COLUMNS);
}
