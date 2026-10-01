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
  type RefObject,
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
  isDirty: () => boolean;
  clear: () => void;
  confirmDiscard: () => Promise<boolean>;
  confirmChoice: (choice: ConfirmChoice) => Promise<boolean>;
};

type GuardContextValue = {
  unsaved: boolean;
  report: (unsaved: boolean) => void;
};

const GuardContext = createContext<GuardContextValue | null>(null);

let published: RefObject<GuardApi | null> | null = null;

/**
 * Asks before throwing away unsaved edits. Resolves true immediately when the editor is clean,
 * and true when the provider is not mounted (nothing is open to lose).
 */
export function confirmDiscard(): Promise<boolean> {
  return published?.current?.confirmDiscard() ?? Promise.resolve(true);
}

/** The same dialog as Discard, with the caller's own text. Resolves false when no provider is mounted. */
export function confirmChoice(choice: ConfirmChoice): Promise<boolean> {
  return published?.current?.confirmChoice(choice) ?? Promise.resolve(false);
}

function clearUnsaved(): void {
  published?.current?.clear();
}

export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const [unsaved, setUnsaved] = useState(false);
  const [pending, setPending] = useState<PendingChoice | null>(null);
  const unsavedRef = useRef(false);
  const pendingRef = useRef<PendingChoice | null>(null);
  const apiRef = useRef<GuardApi | null>(null);

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
    apiRef.current = {
      isDirty: () => unsavedRef.current,
      clear: () => {
        unsavedRef.current = false;
        setUnsaved(false);
      },
      confirmDiscard: () => (unsavedRef.current ? ask(DISCARD_CHOICE) : Promise.resolve(true)),
      confirmChoice: ask,
    };
    published = apiRef;
    return () => {
      apiRef.current = null;
      if (published === apiRef) published = null;
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

  useEffect(() => {
    if (!pending) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      settle(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, settle]);

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

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

/**
 * A link that asks before leaving the Template with unsaved edits.
 * Same-pathname links (pane toggles, Source row links, `?row=`) are never guarded.
 * On confirm, the flag is cleared and the navigation continues, so a failed leave can be guarded again
 * only after the editor reports dirty once more.
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
        let prevented = false;
        onNavigate?.({
          preventDefault() {
            prevented = true;
            event.preventDefault();
          },
        });
        if (prevented) return;
        if (!guard.unsaved || samePathname(href, pathname)) return;
        event.preventDefault();
        void confirmDiscard().then((accepted) => {
          if (!accepted) return;
          clearUnsaved();
          router.push(href);
        });
      }}
    />
  );
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

function ConfirmDialog({
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmChoice & { onConfirm: () => void; onCancel: () => void }) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/20 p-6 dark:bg-black/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${glassClass} w-full max-w-sm rounded-2xl px-6 py-5`}
      >
        <p id={titleId} className="text-neutral-900 dark:text-white">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" ref={cancelRef} className={primaryButtonClass} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
