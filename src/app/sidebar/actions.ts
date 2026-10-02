"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { blankPlan } from "@/app/sidebar/sidebar-view";
import { templateHref } from "@/app/template-view";
import { getDb } from "@/db/server";

const blankInput = z.object({
  name: z.string(),
});

type BlankResult = { ok: false; error: { kind: "name-blank" } };

/**
 * Creates an empty Template and opens it. Arguments are untrusted.
 * Trim matches Save (`String#trim`, U+00A0 included). A blank name is `name-blank`.
 * Success redirects to the editor with no panes. `redirect` throws, so it stays outside `try`.
 * A thrown action is `blank-failed` on the client.
 */
export async function createBlank(name: string): Promise<BlankResult> {
  const parsed = blankInput.safeParse({ name });
  if (!parsed.success) throw new Error("Blank received arguments it cannot store");

  const plan = blankPlan(parsed.data.name);
  if (plan.kind === "blank") return { ok: false, error: { kind: "name-blank" } };

  const created = await getDb().createBlankTemplate(plan.name);
  revalidatePath("/", "layout");
  redirect(templateHref(created.templateId, { panes: new Set(), row: null }));
}

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

type DuplicateResult = { ok: false; error: { kind: "template-not-found" } };

/**
 * Copies a Template and opens the Copy. Arguments are untrusted.
 * `template-not-found` is returned. Success redirects to the Copy with no panes.
 * `redirect` throws, so it stays outside `try`. A thrown action is `duplicate-failed` on the client.
 */
export async function duplicate(templateId: string): Promise<DuplicateResult> {
  const parsed = duplicateInput.safeParse({ templateId });
  if (!parsed.success) throw new Error("Duplicate received arguments it cannot store");

  const duplicated = await getDb().duplicateTemplate(parsed.data.templateId);
  if (!duplicated.ok) {
    if (duplicated.error.kind !== "template-not-found") throw new Error("Duplicate refused unexpectedly");
    return { ok: false, error: duplicated.error };
  }

  revalidatePath("/", "layout");
  redirect(templateHref(duplicated.value.templateId, { panes: new Set(), row: null }));
}
