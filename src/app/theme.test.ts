import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, parseTheme, themeAttribute, themeCookie } from "@/app/theme";

describe("parseTheme", () => {
  it("defaults to System when the cookie is missing or invalid", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("blue")).toBe("system");
    expect(parseTheme("Light")).toBe("system");
  });

  it("keeps a stored Light, Dark or System choice", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("leaves the attribute off for System and sets it for a forced theme", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("themeCookie", () => {
  it("stores the choice for a year on every path", () => {
    expect(themeCookie("dark")).toBe("theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(themeCookie("system")).toBe("theme=system; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});

describe("applyTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forces dark on the document and writes the cookie", () => {
    const dom = installDocument();
    applyTheme("dark");
    expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(dom.window.document.cookie).toContain("theme=dark");
  });

  it("forces light the same way", () => {
    const dom = installDocument();
    applyTheme("light");
    expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(dom.window.document.cookie).toContain("theme=light");
  });

  it("clears a forced theme when the choice returns to System", () => {
    const dom = installDocument();
    dom.window.document.documentElement.setAttribute("data-theme", "dark");
    applyTheme("system");
    expect(dom.window.document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(dom.window.document.cookie).toContain("theme=system");
  });
});

function installDocument(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("window", dom.window);
  return dom;
}
