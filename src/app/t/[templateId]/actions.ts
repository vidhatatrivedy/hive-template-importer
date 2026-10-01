"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RestoreError, SaveError } from "@/core/import/editor-messages";
import { prepareSave } from "@/core/import/prepare-save";
import { editableTreeSchema, type EditableTree } from "@/core/import/schemas";
import { templateHref, type TemplateView } from "@/app/template-view";
import { getDb } from "@/db/server";

/** Stores the working tree as the next Version. Arguments are untrusted. */
export async function saveTemplate(
  templateId: string,
  baseNumber: number,
  tree: EditableTree,
): Promise<{ ok: true; number: number } | { ok: false; error: SaveError }> {
  const prepared = prepareSave(tree);
  if (!prepared.ok) return { ok: false, error: { kind: "names-blank", count: prepared.blank.length } };

  const parsed = editableTreeSchema.safeParse(prepared.tree);
  if (!parsed.success) throw new Error("Save received a tree the editor cannot store");

  const saved = await getDb().saveVersion(templateId, baseNumber, parsed.data);
  if (!saved.ok) return { ok: false, error: saved.error };

  revalidatePath("/", "layout");
  return { ok: true, number: saved.value.number };
}

/**
 * Copies the viewed Version into a new latest Version. Arguments are untrusted.
 * A refusal is returned. Success redirects to the editor, outside `try`, because `redirect` throws.
 */
export async function restoreVersion(
  templateId: string,
  versionId: string,
  baseNumber: number,
  panes: TemplateView["panes"],
): Promise<{ ok: false; error: RestoreError }> {
  const restored = await getDb().restoreVersion(versionId, baseNumber);
  if (!restored.ok) {
    // restore_version only refuses stale-base and template-not-found. A Source-row refusal is a bug.
    if (restored.error.kind === "foreign-source-row") throw new Error("Restore refused a Source row");
    return { ok: false, error: restored.error };
  }

  revalidatePath("/", "layout");
  redirect(templateHref(templateId, { panes, row: null }));
}
