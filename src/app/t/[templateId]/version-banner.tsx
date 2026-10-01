"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { restoreErrorMessage, type RestoreError } from "@/core/import/editor-messages";
import { templateHref, type TemplateView } from "@/app/template-view";
import { restorePrompt } from "@/app/version-label";
import { ConfirmDialog, GuardedLink } from "@/app/unsaved-guard";
import { buttonClass } from "@/app/ui/classes";
import { FormattedDate } from "@/app/ui/formatted-date";
import { restoreVersion } from "./actions";

/** Across the editor while an old Version is open. */
export function VersionBanner({
  templateId,
  versionId,
  number,
  latestNumber,
  label,
  savedAt,
  panes,
}: {
  templateId: string;
  versionId: string;
  number: number;
  latestNumber: number;
  label: string;
  savedAt: string;
  panes: TemplateView["panes"];
}) {
  const router = useRouter();
  const lock = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RestoreError | null>(null);
  const backHref = templateHref(templateId, { panes, row: null });
  const errorMessage = error ? restoreErrorMessage(error) : null;

  async function confirmRestore() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    let navigated = false;
    try {
      const result = await restoreVersion(templateId, versionId, latestNumber, panes);
      if (!result.ok) {
        setError(result.error);
        setOpen(false);
      }
    } catch (caught) {
      if (isNextRedirect(caught)) {
        navigated = true;
        return;
      }
      setError({ kind: "restore-failed" });
      setOpen(false);
    } finally {
      if (!navigated) {
        lock.current = false;
        setPending(false);
      }
    }
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
      <p className="min-w-0 flex-1 truncate" role={error ? "alert" : undefined} title={errorMessage ?? undefined}>
        {errorMessage ?? (
          <>
            Viewing Version {number} · {label} · <FormattedDate value={savedAt} />
          </>
        )}
      </p>
      {error?.kind === "stale-base" ? (
        <button type="button" className={`${buttonClass} shrink-0`} onClick={() => router.refresh()}>
          Reload
        </button>
      ) : null}
      {error?.kind === "template-not-found" ? (
        <Link href="/import" className={`${buttonClass} shrink-0`}>
          Import
        </Link>
      ) : null}
      <button
        type="button"
        className={`${buttonClass} shrink-0`}
        disabled={pending}
        onClick={() => {
          if (pending) return;
          setOpen(true);
        }}
      >
        {pending ? "Restoring…" : "Restore this version"}
      </button>
      <GuardedLink href={backHref} className={`${buttonClass} shrink-0`}>
        Back to current
      </GuardedLink>
      {open ? (
        <ConfirmDialog
          message={restorePrompt(number, latestNumber)}
          confirmLabel={pending ? "Restoring…" : "Restore"}
          cancelLabel="Cancel"
          pending={pending}
          onConfirm={() => void confirmRestore()}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** A Server Action `redirect` rejects the client promise. That is navigation, not a failed Restore. */
function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT")
  );
}
