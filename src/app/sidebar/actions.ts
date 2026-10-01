"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/server";

/**
 * Stores a new Template name. Arguments are untrusted.
 * Trim matches Blank and Save (`String#trim`, U+00A0 included). No Version, no redirect.
 * A thrown action is `rename-failed` on the client.
 */
export async function renameTemplate(
  templateId: string,
  name: string,
): Promise<{ ok: true } | { ok: false; error: { kind: "name-blank" } | { kind: "template-not-found" } }> {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, error: { kind: "name-blank" } };

  const renamed = await getDb().renameTemplate(templateId, trimmed);
  if (!renamed.ok) {
    if (renamed.error.kind !== "template-not-found") throw new Error("Rename refused unexpectedly");
    return { ok: false, error: renamed.error };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
