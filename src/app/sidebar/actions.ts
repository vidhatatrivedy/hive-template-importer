"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { templateHref } from "@/app/template-view";
import { getDb } from "@/db/server";

const renameInput = z.object({
  templateId: z.string(),
  name: z.string(),
});

type RenameResult =
  | { ok: true }
  | { ok: false; error: { kind: "name-blank" } | { kind: "template-not-found" } };

/**
 * Stores a new Template name. Arguments are untrusted.
 * Trim matches Blank and Save (`String#trim`, U+00A0 included). No Version, no redirect.
 * A thrown action is `rename-failed` on the client.
 */
export async function renameTemplate(templateId: string, name: string): Promise<RenameResult> {
  const parsed = renameInput.safeParse({ templateId, name });
  if (!parsed.success) throw new Error("Rename received arguments it cannot store");

  const trimmed = parsed.data.name.trim();
  if (trimmed === "") return { ok: false, error: { kind: "name-blank" } };

  const renamed = await getDb().renameTemplate(parsed.data.templateId, trimmed);
  if (!renamed.ok) {
    if (renamed.error.kind !== "template-not-found") throw new Error("Rename refused unexpectedly");
    return { ok: false, error: renamed.error };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

const duplicateInput = z.object({
  templateId: z.string(),
});

/**
 * Copies a Template and opens the Copy. Arguments are untrusted.
 * `template-not-found` is returned. Success redirects to the Copy with no panes.
 * `redirect` throws, so it stays outside `try`. A thrown action is `duplicate-failed` on the client.
 */
export async function duplicate(templateId: string): Promise<{ ok: false; error: { kind: "template-not-found" } }> {
  const parsed = duplicateInput.safeParse({ templateId });
  if (!parsed.success) throw new Error("Duplicate received arguments it cannot store");

  const duplicated = await getDb().duplicateTemplate(parsed.data.templateId);
  if (!duplicated.ok) {
    if (duplicated.error.kind !== "template-not-found") throw new Error("Duplicate refused unexpectedly");
    return { ok: false, error: { kind: "template-not-found" } };
  }

  revalidatePath("/", "layout");
  redirect(templateHref(duplicated.value.templateId, { panes: new Set(), row: null }));
}
