import type { ReactNode } from "react";

/** Soft grey shapes behind the glass, so the blur has something to frost. */
export function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-screen min-w-[1200px] overflow-hidden bg-neutral-100 font-[family-name:var(--font-geist-sans)] text-[12px] leading-[1.45] text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      <div className="pointer-events-none absolute -top-40 -left-20 h-[520px] w-[520px] rounded-full bg-neutral-300/70 blur-3xl dark:bg-neutral-700/40" />
      <div className="pointer-events-none absolute right-[-100px] bottom-[-200px] h-[600px] w-[600px] rounded-full bg-neutral-400/40 blur-3xl dark:bg-neutral-800/60" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-[300px] w-[300px] rounded-full bg-white/80 blur-3xl dark:bg-neutral-600/20" />
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}
