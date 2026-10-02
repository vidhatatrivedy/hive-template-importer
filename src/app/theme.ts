/** The colour theme, kept in a cookie so the server can paint it before the page is shown. */

import { z } from "zod";

const themeChoiceSchema = z.enum(["light", "dark", "system"]);

export type ThemeChoice = z.infer<typeof themeChoiceSchema>;

export const THEME_COOKIE = "theme";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const themeListeners = new Set<() => void>();

/** System when the cookie is missing or not one of the three choices. */
export function parseTheme(value: string | null | undefined): ThemeChoice {
  const parsed = themeChoiceSchema.safeParse(value);
  if (!parsed.success) return "system";
  return parsed.data;
}

/** Absent on `<html>` for System, so the OS preference still applies. */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | undefined {
  if (choice === "system") return undefined;
  return choice;
}

/** A year, every path, so a reload and any route see the same choice. */
export function themeCookie(choice: ThemeChoice): string {
  return `${THEME_COOKIE}=${choice}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** The choice currently stored in `document.cookie`. */
export function readThemeCookie(): ThemeChoice {
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE}=`));
  return parseTheme(entry?.slice(THEME_COOKIE.length + 1));
}

/** Notifies after `applyTheme`, so a remounted switch can read the cookie just written. */
export function subscribeToTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

/** Applies the choice immediately. Does not navigate or reload. */
export function applyTheme(choice: ThemeChoice): void {
  const attribute = themeAttribute(choice);
  if (attribute === undefined) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", attribute);
  document.cookie = themeCookie(choice);
  for (const listener of themeListeners) listener();
}
