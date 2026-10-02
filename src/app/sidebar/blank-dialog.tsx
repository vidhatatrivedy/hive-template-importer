"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { lifecycleErrorMessage, type LifecycleError } from "@/core/import/lifecycle-messages";
import { isNextRedirect } from "@/app/is-next-redirect";
import { createBlank } from "@/app/sidebar/actions";
import { blankPlan, lifecyclePrompt, parseOpenTemplate } from "@/app/sidebar/sidebar-view";
import { confirmDiscard, useUnsaved } from "@/app/unsaved-guard";
import { buttonClass, glassClass, primaryButtonClass } from "@/app/ui/classes";

/** One Blank at a time. Cleared when the route changes or the action fails. */
let blankInFlight = false;

function beginBlank(): boolean {
  if (blankInFlight) return false;
  blankInFlight = true;
  return true;
}

function endBlank() {
  blankInFlight = false;
}

/**
 * "New blank Template". Opened from the sidebar's New ▸ Blank and, the same way, from the empty state.
 * Cancelling never touches edits. Discard is asked only after Create, and Keep editing returns here
 * with the name kept. A thrown action stays in this dialog as `blank-failed`.
 */
export function BlankDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  /** Set before `pending` so a second submit in the same turn is ignored. */
  const submitting = useRef(false);
  /** The discard prompt is open, so a second Create must not stack another one. */
  const awaitingConfirm = useRef(false);
  const onCloseRef = useRef(onClose);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [hiddenForDiscard, setHiddenForDiscard] = useState(false);
  const [error, setError] = useState<LifecycleError<"blank"> | null>(null);
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const open = parseOpenTemplate(pathname);
  const dirty = useUnsaved();
  const plan = blankPlan(draft);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    endBlank();
    onCloseRef.current();
  }, [pathname]);

  useEffect(() => {
    if (hiddenForDiscard) return;
    fieldRef.current?.focus();
  }, [hiddenForDiscard]);

  useEffect(() => {
    if (hiddenForDiscard) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || submitting.current) return;
      event.preventDefault();
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hiddenForDiscard]);

  function close() {
    if (submitting.current || awaitingConfirm.current) return;
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || awaitingConfirm.current || blankInFlight) return;
    if (plan.kind === "blank") return;

    const prompt = lifecyclePrompt("blank", null, { open, dirty });
    if (prompt.kind === "discard") {
      awaitingConfirm.current = true;
      setHiddenForDiscard(true);
      const accepted = await confirmDiscard();
      awaitingConfirm.current = false;
      setHiddenForDiscard(false);
      if (!accepted) return;
    } else if (prompt.kind !== "none") {
      return;
    }

    if (submitting.current || !beginBlank()) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createBlank(plan.name);
      endBlank();
      setError(result.error);
      submitting.current = false;
      setPending(false);
    } catch (caught) {
      if (isNextRedirect(caught)) return;
      endBlank();
      setError({ kind: "blank-failed" });
      submitting.current = false;
      setPending(false);
    }
  }

  if (hiddenForDiscard) return null;

  // Portaled: the sidebar and the editor card use backdrop-filter and overflow, which trap `fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/20 p-6 dark:bg-black/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${glassClass} w-full max-w-sm rounded-2xl px-6 py-5`}
      >
        <h2 id={titleId} className="text-neutral-900 dark:text-white">
          New blank Template
        </h2>
        <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Name</span>
            <input
              ref={fieldRef}
              value={draft}
              disabled={pending}
              autoComplete="off"
              placeholder="Template name"
              onChange={(event) => setDraft(event.currentTarget.value)}
              className="h-7 rounded-md border border-black/[0.08] bg-white/60 px-2 text-[12px] dark:border-white/[0.1] dark:bg-neutral-900/60"
            />
          </label>
          {error ? (
            <p role="alert" className="text-neutral-500">
              {lifecycleErrorMessage("blank", error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} disabled={pending} onClick={close}>
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass} disabled={plan.kind === "blank" || pending}>
              {pending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
