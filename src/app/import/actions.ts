"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseSpectoraExport, type ParseResult } from "@/core/import/parse-spectora-export";
import { getDb } from "@/db/server";
import { toImportReview } from "@/app/import/import-review";
import type { CommitResult, PreviewResult } from "@/app/import/import-flow";
import { templateHref } from "@/app/template-view";

const previewForm = z.object({ file: z.instanceof(File) });
const commitForm = previewForm.extend({ sha256: z.string(), name: z.string() });

/** Parses the uploaded file and returns the review's counts. Stores nothing. */
export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const { file } = previewForm.parse(Object.fromEntries(formData));
  const parsed = await parseUpload(file);
  if (!parsed.ok) return { ok: false, error: parsed.rejection };
  return { ok: true, review: toImportReview(parsed.draft) };
}

/** Re-parses the reviewed file, stores it under the trimmed name and opens its Trust Report. */
export async function commitImport(formData: FormData): Promise<CommitResult> {
  const { file, sha256, name } = commitForm.parse(Object.fromEntries(formData));
  const parsed = await parseUpload(file);
  if (!parsed.ok) return { ok: false, error: parsed.rejection };
  if (parsed.draft.run.sha256 !== sha256) return { ok: false, error: { kind: "hash-mismatch" } };
  const trimmedName = name.trim();
  if (trimmedName === "") return { ok: false, error: { kind: "name-blank" } };

  const { templateId } = await getDb().importTemplate(parsed.draft, trimmedName);
  revalidatePath("/", "layout");
  redirect(templateHref(templateId, { panes: new Set(["trust"]), row: null }));
}

async function parseUpload(file: File): Promise<ParseResult> {
  return parseSpectoraExport(new Uint8Array(await file.arrayBuffer()), file.name);
}
