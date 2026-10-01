import { z } from "zod";

/** Origins allowed on Version 1. Compared with `versions_number_origin_check`. */
const versionOneOrigins = ["import", "blank", "copy"] as const;

/** How a Version came to exist. Compared with the database check of the same name. */
export const versionOrigins = [...versionOneOrigins, "save", "restore"] as const;
export type VersionOrigin = (typeof versionOrigins)[number];

const timestamp = z.string().min(1);

const countsSchema = z.object({
  sections: z.number().int().nonnegative(),
  items: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
});

const importRunSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  importedAt: timestamp,
  byteSize: z.number().int().nonnegative(),
});

const copiedFromSchema = z.object({
  templateId: z.uuid().nullable(),
  templateName: z.string().min(1),
  versionNumber: z.number().int().positive(),
});

const latestVersionSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  savedAt: timestamp,
});

const versionSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  savedAt: timestamp,
  origin: z.enum(versionOrigins),
  restoredFromNumber: z.number().int().positive().nullable(),
  counts: countsSchema,
});

const templateSummaryImportRunSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  importedAt: timestamp,
});

export const templateSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  creation: z.enum(versionOneOrigins),
  copiedFromName: z.string().min(1).nullable(),
  importRun: templateSummaryImportRunSchema.nullable(),
  latest: latestVersionSchema,
});

export const templateSummaryListSchema = z.array(templateSummarySchema);

export type TemplateSummary = z.infer<typeof templateSummarySchema>;

export const templateDetailSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  createdAt: timestamp,
  creation: z.enum(versionOneOrigins),
  copiedFrom: copiedFromSchema.nullable(),
  importRun: importRunSchema.nullable(),
  latest: latestVersionSchema,
  versions: z.array(versionSummarySchema),
});

export type TemplateDetail = z.infer<typeof templateDetailSchema>;

/** Expected refusals. Message text stays in core; this layer returns kinds and data only. */
export type DbRefusal =
  | { kind: "stale-base"; latestNumber: number }
  | { kind: "template-not-found" }
  | { kind: "foreign-source-row"; rowNumbers: number[] };

export type Result<T> = { ok: true; value: T } | { ok: false; error: DbRefusal };

export const importTemplateResultSchema = z.object({
  templateId: z.uuid(),
  versionId: z.uuid(),
  importRunId: z.uuid(),
});

export const deleteTemplateResultSchema = z.object({
  importRunDeleted: z.boolean(),
});

export const duplicateTemplateResultSchema = z.object({
  templateId: z.uuid(),
  versionId: z.uuid(),
});

export const createBlankTemplateResultSchema = z.object({
  templateId: z.uuid(),
  versionId: z.uuid(),
});

export const saveVersionResultSchema = z.object({
  versionId: z.uuid(),
  number: z.number().int().positive(),
});

export const restoreVersionResultSchema = z.object({
  versionId: z.uuid(),
  number: z.number().int().positive(),
});

export type ImportTemplateResult = z.infer<typeof importTemplateResultSchema>;
export type DeleteTemplateResult = z.infer<typeof deleteTemplateResultSchema>;
export type DuplicateTemplateResult = z.infer<typeof duplicateTemplateResultSchema>;
export type CreateBlankTemplateResult = z.infer<typeof createBlankTemplateResultSchema>;
export type SaveVersionResult = z.infer<typeof saveVersionResultSchema>;
export type RestoreVersionResult = z.infer<typeof restoreVersionResultSchema>;
