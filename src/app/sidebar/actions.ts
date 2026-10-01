"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
