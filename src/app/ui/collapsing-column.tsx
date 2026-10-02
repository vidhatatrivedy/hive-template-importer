import type { ReactNode } from "react";

/**
 * Open column (w-56) or strip (w-9 / 36px). Width eases over 200ms. Both layers stay
 * mounted so a collapse keeps the list's scroll position and any unsaved edits.
 * The open layer is a fixed w-56 clipped by the shell, so it doesn't squash mid-way.
 * prefers-reduced-motion skips the transition. The width class is set on first paint,
 * so loading a Template or opening another one does not animate.
 */
export function CollapsingColumn({
  collapsed,
  strip,
  children,
}: {
  collapsed: boolean;
  strip: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-black/[0.05] transition-[width] duration-200 ease-out motion-reduce:transition-none dark:border-white/[0.06] ${
        collapsed ? "w-9" : "w-56"
      }`}
    >
      <div
        inert={collapsed ? true : undefined}
        aria-hidden={collapsed ? true : undefined}
        className={`flex min-h-0 w-56 flex-1 flex-col transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          collapsed ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {children}
      </div>
      <div
        inert={collapsed ? undefined : true}
        aria-hidden={collapsed ? undefined : true}
        className={`absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          collapsed ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {strip}
      </div>
    </section>
  );
}
