import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
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
  importTemplateResultSchema,
  templateDetailSchema,
  type DbRefusal,
  type DeleteTemplateResult,
  type ImportTemplateResult,
  type Result,
  type TemplateDetail,
} from "@/db/schemas";

export type {
  DbRefusal,
  DeleteTemplateResult,
  ImportTemplateResult,
  Result,
  TemplateDetail,
  VersionOrigin,
} from "@/db/schemas";
export { templateDetailSchema, versionOrigins } from "@/db/schemas";

/** `PT404` is the SQLSTATE `delete_template` raises. Mapped by code, never by message text. */
const TEMPLATE_NOT_FOUND = "PT404";

export interface Db {
  importTemplate(draft: ImportDraft, name: string): Promise<ImportTemplateResult>;
  deleteTemplate(templateId: string): Promise<Result<DeleteTemplateResult>>;
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

function refusalFrom(error: PostgrestError): DbRefusal | null {
  if (error.code !== TEMPLATE_NOT_FOUND) return null;
  return { kind: "template-not-found" };
}
