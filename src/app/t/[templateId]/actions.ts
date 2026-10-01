"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RestoreError, SaveError } from "@/core/import/editor-messages";
import { prepareSave } from "@/core/import/prepare-save";
import { editableTreeSchema, type EditableTree } from "@/core/import/schemas";
import { templateHref, type TemplatePane, type TemplateView } from "@/app/template-view";
import { getDb } from "@/db/server";

/** Same members as `TemplatePane`. `satisfies` fails the build if a pane is added and left off this list. */
const templatePanes = { trust: true, versions: true } satisfies Record<TemplatePane, true>;
const templatePaneSchema = z.enum(Object.keys(templatePanes) as [TemplatePane, ...TemplatePane[]]);

/**
 * Panes safe to put back on the editor URL. Anything that is not a Set is refused
 * before the write. Unknown entries are dropped, which is what `templateHref` already does.
 */
function panesForRedirect(panes: unknown): Set<TemplatePane> {
  const parsed = z.instanceof(Set).safeParse(panes);
  if (!parsed.success) throw new Error("Restore received panes the editor cannot store");

  const known = new Set<TemplatePane>();
  for (const pane of parsed.data) {
    const entry = templatePaneSchema.safeParse(pane);
    if (entry.success) known.add(entry.data);
  }
  return known;
}

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
 * A refusal is returned. Success redirects to the editor. `redirect` throws, so it is not inside `try`.
 */
export async function restoreVersion(
  templateId: string,
  versionId: string,
  baseNumber: number,
  panes: TemplateView["panes"],
): Promise<{ ok: false; error: RestoreError }> {
  const redirectPanes = panesForRedirect(panes);
  const restored = await getDb().restoreVersion(versionId, baseNumber);
  if (!restored.ok) {
    // restore_version only refuses stale-base and template-not-found. A Source-row refusal is a bug.
    if (restored.error.kind === "foreign-source-row") throw new Error("Restore refused a Source row");
    return { ok: false, error: restored.error };
  }

  revalidatePath("/", "layout");
  redirect(templateHref(templateId, { panes: redirectPanes, row: null }));
}
