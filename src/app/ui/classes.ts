import type { IssueSeverity } from "@/core/import/catalogue";

/** Visual language from the layout prototype (variant B) and docs/spec/design.md. */

export const glassClass =
  "bg-white/55 dark:bg-neutral-900/55 backdrop-blur-2xl backdrop-saturate-150 border border-black/[0.07] dark:border-white/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]";

/** Denser fill the prototype uses for sheets. */
export const glassSheetClass = `${glassClass} !bg-white/75 dark:!bg-neutral-900/75`;

export const labelClass = "text-[10px] uppercase tracking-[0.08em] text-neutral-400";

export const buttonClass =
  "inline-flex h-6 items-center rounded-md border border-black/[0.08] px-2.5 text-[11px] hover:bg-black/[0.04] dark:border-white/[0.1] dark:hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-40";

export const primaryButtonClass =
  "inline-flex h-6 items-center rounded-md bg-neutral-900 px-2.5 text-[11px] text-white dark:bg-white dark:text-neutral-900 disabled:pointer-events-none disabled:opacity-40";

/** Import issue severity is weight, never colour. */
export const severityWarningClass = "font-medium text-neutral-900 dark:text-white";

export const severityNoticeClass = "font-normal text-neutral-400";

export const severityClass: Record<IssueSeverity, string> = {
  warning: severityWarningClass,
  notice: severityNoticeClass,
};
