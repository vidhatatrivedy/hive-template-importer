"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { getDb } from "@/db/server";
import { toImportReview } from "@/app/import/import-review";
import type { CommitResult, PreviewResult } from "@/app/import/import-flow";
import { templateHref } from "@/app/template-view";

/** Parses the uploaded file and returns the review's counts. Stores nothing. */
export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const file = fileField(formData);
  const parsed = await parseSpectoraExport(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!parsed.ok) return { ok: false, error: parsed.rejection };
  return { ok: true, review: toImportReview(parsed.draft) };
}

/** Re-parses the reviewed file, stores it under the trimmed name and opens its Trust Report. */
export async function commitImport(formData: FormData): Promise<CommitResult> {
  const file = fileField(formData);
  const sha256 = formData.get("sha256");
  const name = formData.get("name");
  if (typeof sha256 !== "string" || typeof name !== "string") throw new Error("Import form is missing a field");

  const parsed = await parseSpectoraExport(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!parsed.ok) return { ok: false, error: parsed.rejection };
  if (parsed.draft.run.sha256 !== sha256) return { ok: false, error: { kind: "hash-mismatch" } };
  const trimmedName = name.trim();
  if (trimmedName === "") return { ok: false, error: { kind: "name-blank" } };

  const { templateId } = await getDb().importTemplate(parsed.draft, trimmedName);
  revalidatePath("/", "layout");
  redirect(templateHref(templateId, { panes: new Set(["trust"]), row: null }));
}

function fileField(formData: FormData): File {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Import form has no file");
  return file;
}
