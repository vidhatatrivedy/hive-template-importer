"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { buttonClass, glassClass, primaryButtonClass } from "@/app/ui/classes";

/** Wording for the shared confirm dialog. Later prompts pass their own. */
export type ConfirmChoice = {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

const DISCARD_CHOICE: ConfirmChoice = {
  message: "Discard unsaved changes?",
  confirmLabel: "Discard",
  cancelLabel: "Keep editing",
};

type PendingChoice = ConfirmChoice & { resolve: (accepted: boolean) => void };

type GuardApi = {
  confirmDiscard: () => Promise<boolean>;
  confirmChoice: (choice: ConfirmChoice) => Promise<boolean>;
};

type GuardContextValue = {
  unsaved: boolean;
  report: (unsaved: boolean) => void;
};

const GuardContext = createContext<GuardContextValue | null>(null);

/** The mounted provider's imperative API. Null before mount and after unmount. */
let mountedGuard: GuardApi | null = null;

/**
 * Asks before throwing away unsaved edits. Resolves true immediately when the editor is clean,
 * and true when the provider is not mounted (nothing is open to lose).
 */
export function confirmDiscard(): Promise<boolean> {
  return mountedGuard?.confirmDiscard() ?? Promise.resolve(true);
}

/** The same dialog as Discard, with the caller's own text. Resolves false when no provider is mounted. */
export function confirmChoice(choice: ConfirmChoice): Promise<boolean> {
  return mountedGuard?.confirmChoice(choice) ?? Promise.resolve(false);
}

export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const [unsaved, setUnsaved] = useState(false);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  /** Latest dirty flag, read by confirm before the next render. */
  const unsavedRef = useRef(false);
  /** The open prompt, so a second one can cancel it before React re-renders. */
  const pendingRef = useRef<PendingChoice | null>(null);

  const report = useCallback((next: boolean) => {
    unsavedRef.current = next;
    setUnsaved(next);
  }, []);

  const settle = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(accepted);
  }, []);

  const ask = useCallback((choice: ConfirmChoice) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...choice, resolve };
      const previous = pendingRef.current;
      pendingRef.current = next;
      setPending(next);
      previous?.resolve(false);
    });
  }, []);

  useEffect(() => {
    const api: GuardApi = {
      confirmDiscard: () => (unsavedRef.current ? ask(DISCARD_CHOICE) : Promise.resolve(true)),
      confirmChoice: ask,
    };
    mountedGuard = api;
    return () => {
      if (mountedGuard === api) mountedGuard = null;
    };
  }, [ask]);

  useEffect(() => {
    if (!unsaved) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  const value = useMemo(() => ({ unsaved, report }), [unsaved, report]);

  return (
    <GuardContext.Provider value={value}>
      {children}
      {pending ? (
        <ConfirmDialog
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </GuardContext.Provider>
  );
}

/** The editor reports whether the open Template has unsaved edits. Cleanup clears the flag on unmount. */
export function useReportUnsaved(unsaved: boolean) {
  const { report } = useGuard();
  useEffect(() => {
    report(unsaved);
    return () => report(false);
  }, [report, unsaved]);
}

/** Whether the open Template has unsaved edits, for prompts that decide before asking. */
export function useUnsaved(): boolean {
  return useGuard().unsaved;
}

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/**
 * A link that asks before leaving the Template with unsaved edits.
 * Same-pathname links (pane toggles, Source row links, `?row=`) are never guarded.
 * On confirm the navigation continues and the flag is left alone: it clears only when the editor unmounts,
 * so a navigation that doesn't leave keeps the edits guarded.
 */
export function GuardedLink({ href, onNavigate, ...props }: GuardedLinkProps) {
  const guard = useGuard();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Link
      {...props}
      href={href}
      onNavigate={(event) => {
        if (callerCancelledNavigation(onNavigate, event)) return;
        if (!guard.unsaved || samePathname(href, pathname)) return;
        event.preventDefault();
        void confirmDiscard().then((accepted) => {
          if (accepted) router.push(href);
        });
      }}
    />
  );
}

function callerCancelledNavigation(
  onNavigate: GuardedLinkProps["onNavigate"],
  event: { preventDefault: () => void },
): boolean {
  let cancelled = false;
  onNavigate?.({
    preventDefault() {
      cancelled = true;
      event.preventDefault();
    },
  });
  return cancelled;
}

function useGuard(): GuardContextValue {
  const guard = useContext(GuardContext);
  if (!guard) throw new Error("Unsaved guard is not mounted");
  return guard;
}

function samePathname(href: string, pathname: string): boolean {
  const path = href.split(/[?#]/)[0] ?? "";
  return path === pathname;
}

export function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  pending = false,
  children,
}: ConfirmChoice & {
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables confirm so a running action cannot be submitted twice. */
  pending?: boolean;
  children?: ReactNode;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault();
      onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pending]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/20 p-6 dark:bg-black/40"
      onMouseDown={(event) => {
        if (pending) return;
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${glassClass} w-full rounded-2xl px-6 py-5 ${children ? "max-w-lg" : "max-w-sm"}`}
      >
        <p id={titleId} className="text-neutral-900 dark:text-white">
          {message}
        </p>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={buttonClass} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" ref={cancelRef} className={primaryButtonClass} disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
