/** Whether columns collapse, kept in a cookie so the server can paint the layout before the page is shown. */

import type { Column } from "@/app/editor/editor-state";

export const COLLAPSE_COLUMNS_COOKIE = "collapse-columns";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const listeners = new Set<() => void>();

/** Off when the cookie is missing or anything other than `on`. */
export function parseCollapseColumns(value: string | null | undefined): boolean {
  return value === "on";
}

/** A year, every path, so a reload and any route see the same choice. */
export function collapseColumnsCookie(enabled: boolean): string {
  const value = enabled ? "on" : "off";
  return `${COLLAPSE_COLUMNS_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** The choice currently stored in `document.cookie`. */
export function readCollapseColumnsCookie(): boolean {
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COLLAPSE_COLUMNS_COOKIE}=`));
  return parseCollapseColumns(entry?.slice(COLLAPSE_COLUMNS_COOKIE.length + 1));
}

/** Notifies after `applyCollapseColumns`, so a remounted switch can read the cookie just written. */
export function subscribeToCollapseColumns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stores the choice immediately. Does not navigate, reload, or touch editor state. */
export function applyCollapseColumns(enabled: boolean): void {
  document.cookie = collapseColumnsCookie(enabled);
  for (const listener of listeners) listener();
}

const COLUMN_ORDER: Record<Column, number> = { sections: 0, items: 1, comments: 2 };

/**
 * With the setting off, every column stays open. With it on, columns to the left of
 * the one in focus collapse. Comments never collapse: focus never sits to their right.
 */
export function columnCollapsed(enabled: boolean, column: Column, focus: Column): boolean {
  if (!enabled) return false;
  return COLUMN_ORDER[column] < COLUMN_ORDER[focus];
}
