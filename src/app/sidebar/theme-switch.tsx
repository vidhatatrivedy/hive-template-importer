"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, readThemeCookie, subscribeToTheme, type ThemeChoice } from "@/app/theme";
import { labelClass } from "@/app/ui/classes";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const pillClass = "inline-flex h-6 items-center rounded-full px-2.5 text-[11px]";

const outlineClass = `${pillClass} border border-black/[0.08] dark:border-white/[0.1]`;

const filledClass = `${pillClass} bg-neutral-900 text-white dark:bg-white dark:text-neutral-900`;

const hiddenUntilExpanded =
  "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";

/**
 * Light / Dark / System, pinned to the bottom of the expanded sidebar.
 * The server prop paints the first response. After that the cookie wins, including when the
 * Template list resolving remounts this switch before the next request.
 */
export function ThemeSwitch({ theme, revealed }: { theme: ThemeChoice; revealed: boolean }) {
  const choice = useSyncExternalStore(subscribeToTheme, readThemeCookie, () => theme);
  const reveal = revealed ? "opacity-100" : hiddenUntilExpanded;
  return (
    <div className={`flex w-60 shrink-0 flex-col gap-1.5 px-3 pb-3 transition-opacity ${reveal}`}>
      <span className={labelClass}>Theme</span>
      <div role="group" aria-label="Theme" className="flex gap-1">
        {CHOICES.map((option) => {
          const selected = option.value === choice;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              className={selected ? filledClass : outlineClass}
              onClick={() => applyTheme(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
