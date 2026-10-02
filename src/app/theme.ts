/** The colour theme, kept in a cookie so the server can paint it before the page is shown. */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_COOKIE = "theme";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** System when the cookie is missing or not one of the three choices. */
export function parseTheme(value: string | null | undefined): ThemeChoice {
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
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

/** Applies the choice immediately. Does not navigate or reload. */
export function applyTheme(choice: ThemeChoice): void {
  const attribute = themeAttribute(choice);
  if (attribute === undefined) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", attribute);
  document.cookie = themeCookie(choice);
}
