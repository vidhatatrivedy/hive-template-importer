"use server";

import { refresh } from "next/cache";
import type { SaveError } from "@/core/import/editor-messages";
import { prepareSave } from "@/core/import/prepare-save";
import { editableTreeSchema, type EditableTree } from "@/core/import/schemas";
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

  refresh();
  return { ok: true, number: saved.value.number };
}
