import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSE_COLUMNS_COOKIE,
  applyCollapseColumns,
  collapseColumnsCookie,
  columnCollapsed,
  parseCollapseColumns,
  readCollapseColumnsCookie,
  subscribeToCollapseColumns,
} from "@/app/collapse-columns";

describe("parseCollapseColumns", () => {
  it("is off when the cookie is missing or not on", () => {
    expect(parseCollapseColumns(undefined)).toBe(false);
    expect(parseCollapseColumns(null)).toBe(false);
    expect(parseCollapseColumns("")).toBe(false);
    expect(parseCollapseColumns("off")).toBe(false);
    expect(parseCollapseColumns("true")).toBe(false);
  });

  it("is on only for the stored on value", () => {
    expect(parseCollapseColumns("on")).toBe(true);
  });
});

describe("collapseColumnsCookie", () => {
  it("stores on or off for a year on every path", () => {
    expect(collapseColumnsCookie(true)).toBe(
      `${COLLAPSE_COLUMNS_COOKIE}=on; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
    expect(collapseColumnsCookie(false)).toBe(
      `${COLLAPSE_COLUMNS_COOKIE}=off; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });
});

describe("columnCollapsed", () => {
  it("never collapses a column while the setting is off", () => {
    expect(columnCollapsed(false, "sections", "items")).toBe(false);
    expect(columnCollapsed(false, "sections", "comments")).toBe(false);
    expect(columnCollapsed(false, "items", "comments")).toBe(false);
  });

  it("collapses columns to the left of the one in focus when the setting is on", () => {
    expect(columnCollapsed(true, "sections", "sections")).toBe(false);
    expect(columnCollapsed(true, "items", "sections")).toBe(false);
    expect(columnCollapsed(true, "comments", "sections")).toBe(false);

    expect(columnCollapsed(true, "sections", "items")).toBe(true);
    expect(columnCollapsed(true, "items", "items")).toBe(false);
    expect(columnCollapsed(true, "comments", "items")).toBe(false);

    expect(columnCollapsed(true, "sections", "comments")).toBe(true);
    expect(columnCollapsed(true, "items", "comments")).toBe(true);
    expect(columnCollapsed(true, "comments", "comments")).toBe(false);
  });
});

describe("applyCollapseColumns", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes the cookie and lets a later read see it", () => {
    installDocument();
    const seen: boolean[] = [];
    const unsubscribe = subscribeToCollapseColumns(() => {
      seen.push(readCollapseColumnsCookie());
    });
    applyCollapseColumns(true);
    applyCollapseColumns(false);
    unsubscribe();
    applyCollapseColumns(true);
    expect(seen).toEqual([true, false]);
    expect(readCollapseColumnsCookie()).toBe(true);
    expect(document.cookie).toContain(`${COLLAPSE_COLUMNS_COOKIE}=on`);
  });
});

describe("collapse columns spec", () => {
  it("describes an opt-in setting that is off by default", () => {
    const design = readFileSync(join(process.cwd(), "docs/spec/design.md"), "utf8");
    const collapsing = design.slice(design.indexOf("**Collapsing:**"), design.indexOf("**Comment detail**"));
    expect(collapsing).toMatch(/off by default/);
    expect(collapsing).toMatch(/opt-in/);
    expect(collapsing).toMatch(/Picking a Section or Item collapses its column/);

    const functional = readFileSync(join(process.cwd(), "docs/spec/functional.md"), "utf8");
    const shell = functional.slice(
      functional.indexOf("## Shell and navigation"),
      functional.indexOf("## Import"),
    );
    expect(shell).toMatch(/off by default/);
    expect(shell).toMatch(/opt-in/);
  });
});

function installDocument(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  vi.stubGlobal("document", dom.window.document);
  return dom;
}
