"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { restoreErrorMessage, type RestoreError } from "@/core/import/editor-messages";
import { isNextRedirect } from "@/app/is-next-redirect";
import { templateHref, type TemplateView } from "@/app/template-view";
import { restorePrompt } from "@/app/version-label";
import { ConfirmDialog, GuardedLink } from "@/app/unsaved-guard";
import { buttonClass } from "@/app/ui/classes";
import { FormattedDate } from "@/app/ui/formatted-date";
import { restoreVersion } from "./actions";

const bannerButton = `${buttonClass} shrink-0`;
const restoringLabel = "Restoring…";

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
  /** Stops a second Restore before `pending` has rendered. */
  const restoreLock = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RestoreError | null>(null);
  const backHref = templateHref(templateId, { panes, row: null });
  const errorMessage = error ? restoreErrorMessage(error) : null;

  async function confirmRestore() {
    if (restoreLock.current) return;
    restoreLock.current = true;
    setPending(true);
    setError(null);

    const attempt = await attemptRestore();
    if (attempt.redirected) return;
    setError(attempt.error);
    setOpen(false);
    restoreLock.current = false;
    setPending(false);
  }

  /** A resolved action is a refusal. `redirect` rejects the promise, which is navigation. */
  async function attemptRestore(): Promise<RestoreAttempt> {
    try {
      const result = await restoreVersion(templateId, versionId, latestNumber, panes);
      return { redirected: false, error: result.error };
    } catch (caught) {
      if (isNextRedirect(caught)) return { redirected: true };
      return { redirected: false, error: { kind: "restore-failed" } };
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
      {restoreRecovery(error, () => router.refresh())}
      <button type="button" className={bannerButton} disabled={pending} onClick={() => setOpen(true)}>
        {pending ? restoringLabel : "Restore this version"}
      </button>
      <GuardedLink href={backHref} className={bannerButton}>
        Back to current
      </GuardedLink>
      {open ? (
        <ConfirmDialog
          message={restorePrompt(number, latestNumber)}
          confirmLabel={pending ? restoringLabel : "Restore"}
          cancelLabel="Cancel"
          pending={pending}
          onConfirm={() => void confirmRestore()}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

type RestoreAttempt = { redirected: true } | { redirected: false; error: RestoreError };

/** Reload or Import, for the two refusals that name a next step. Other failures stay on the banner text. */
function restoreRecovery(error: RestoreError | null, refresh: () => void): ReactNode {
  switch (error?.kind) {
    case "stale-base":
      return (
        <button type="button" className={bannerButton} onClick={refresh}>
          Reload
        </button>
      );
    case "template-not-found":
      return (
        <Link href="/import" className={bannerButton}>
          Import
        </Link>
      );
    default:
      return null;
  }
}
