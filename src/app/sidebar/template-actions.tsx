"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { lifecycleErrorMessage, type LifecycleError } from "@/core/import/lifecycle-messages";
import { renameTemplate } from "@/app/sidebar/actions";
import { renamePlan, type ActionTarget } from "@/app/sidebar/sidebar-view";
import { buttonClass, glassClass, primaryButtonClass, rowIdleClass } from "@/app/ui/classes";

/**
 * The "⋯" menu on a sidebar row and beside the Template name.
 * Rename is wired. Duplicate and Delete are shown for the tickets that follow.
 */
export function TemplateActions({
  target,
  placement,
  revealed = false,
  onOpenChange,
}: {
  target: ActionTarget;
  placement: "row" | "header";
  /** The active sidebar row shows the button without a hover. */
  revealed?: boolean;
  /** The sidebar stays expanded while the menu is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  const menuWasOpen = useRef(false);

  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useLayoutEffect(() => {
    if (menuWasOpen.current === menuOpen) return;
    menuWasOpen.current = menuOpen;
    onOpenChangeRef.current?.(menuOpen);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function close() {
      setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    }
    function onPointerDown(event: MouseEvent) {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (menuRef.current?.contains(node) || buttonRef.current?.contains(node)) return;
      close();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

  const triggerClass = placement === "row" ? rowTriggerClass(revealed || menuOpen) : headerTriggerClass();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClass}
        aria-label={`Actions for ${target.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>
      {menuOpen ? (
        <ActionsMenu
          menuRef={menuRef}
          menuId={menuId}
          anchorRef={buttonRef}
          onRename={() => {
            setMenuOpen(false);
            setRenaming(true);
          }}
        />
      ) : null}
      {renaming ? <RenameDialog target={target} onClose={() => setRenaming(false)} /> : null}
    </>
  );
}

function ActionsMenu({
  menuRef,
  menuId,
  anchorRef,
  onRename,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  menuId: string;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onRename: () => void;
}) {
  const renameRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!menu || !anchor) return;
    placeMenu(menu, anchor);
    renameRef.current?.focus();
  }, [anchorRef, menuRef]);

  const itemClass = `flex h-7 w-full items-center rounded-md px-2 text-left ${rowIdleClass}`;

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="Template actions"
      style={{ visibility: "hidden" }}
      className={`${glassClass} fixed z-40 flex w-36 flex-col rounded-xl p-1`}
    >
      <button ref={renameRef} type="button" role="menuitem" className={itemClass} onClick={onRename}>
        Rename…
      </button>
      <button type="button" role="menuitem" className={itemClass}>
        Duplicate
      </button>
      <button type="button" role="menuitem" className={itemClass}>
        Delete…
      </button>
    </div>,
    document.body,
  );
}

function RenameDialog({ target, onClose }: { target: ActionTarget; onClose: () => void }) {
  const titleId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  /** Set before `pending` so a second submit in the same turn is ignored. */
  const submitting = useRef(false);
  const [draft, setDraft] = useState(target.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LifecycleError<"rename"> | null>(null);
  const plan = renamePlan(target.name, draft);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.select();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || submitting.current) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (plan.kind === "blank") return;
    if (plan.kind === "unchanged") {
      onClose();
      return;
    }

    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await renameTemplate(target.id, plan.name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    } catch {
      setError({ kind: "rename-failed" });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  // Portaled: the sidebar and the editor card use backdrop-filter and overflow, which trap `fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/20 p-6 dark:bg-black/40"
      onMouseDown={(event) => {
        if (submitting.current) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${glassClass} w-full max-w-sm rounded-2xl px-6 py-5`}
      >
        <h2 id={titleId} className="text-neutral-900 dark:text-white">
          Rename Template
        </h2>
        <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Name</span>
            <input
              ref={fieldRef}
              value={draft}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => setDraft(event.currentTarget.value)}
              className="h-7 rounded-md border border-black/[0.08] bg-white/60 px-2 text-[12px] dark:border-white/[0.1] dark:bg-neutral-900/60"
            />
          </label>
          {error ? (
            <p role="alert" className="text-neutral-500">
              {lifecycleErrorMessage("rename", error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={pending}
              onClick={() => {
                if (submitting.current) return;
                onClose();
              }}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass} disabled={plan.kind === "blank" || pending}>
              {pending ? "Renaming…" : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function rowTriggerClass(visible: boolean): string {
  const shown = visible
    ? "opacity-100"
    : "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100";
  return `absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[13px] text-neutral-500 hover:bg-black/[0.06] dark:hover:bg-white/[0.08] ${shown}`;
}

function headerTriggerClass(): string {
  return "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px] text-neutral-500 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]";
}

/** Keeps the popover on screen. Hidden until this runs so it does not flash at the origin. */
function placeMenu(menu: HTMLElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const height = menu.offsetHeight;
  const width = menu.offsetWidth;
  const below = rect.bottom + 4;
  const fitsBelow = below + height <= window.innerHeight - 8;
  const top = fitsBelow ? below : Math.max(8, rect.top - 4 - height);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.visibility = "visible";
}
