import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ColumnStrip } from "@/app/ui/column-strip";

function renderStrip(title: string, stripText: string) {
  const html = renderToStaticMarkup(createElement(ColumnStrip, { title, stripText, onFocus: () => {} }));
  const node = new JSDOM(html).window.document.body.firstElementChild;
  if (!node) throw new Error("collapsed column strip rendered nothing");
  return node;
}

describe("collapsed column strip", () => {
  it("pins a long Section name and a short Item name to the top of the strip", () => {
    const section = renderStrip("Sections", "Basement, Foundation, Crawlspace & Structure");
    expect(section.tagName).toBe("BUTTON");
    expect(section.getAttribute("type")).toBe("button");
    expect(section.getAttribute("aria-label")).toBe("Sections, Basement, Foundation, Crawlspace & Structure");

    const sectionClass = section.className.split(/\s+/);
    expect(sectionClass).toEqual(expect.arrayContaining(["w-9", "py-3", "gap-3", "hover:bg-black/[0.03]"]));
    expect(sectionClass.some((token) => token.startsWith("dark:hover:"))).toBe(true);

    const sectionName = section.children[0];
    const sectionLabel = section.children[1];
    expect(sectionName?.textContent).toBe("Basement, Foundation, Crawlspace & Structure");
    expect(sectionLabel?.textContent).toBe("Sections");
    expect(nameClass(sectionName)).toEqual(
      expect.arrayContaining([
        "[writing-mode:vertical-rl]",
        "rotate-180",
        "text-[11px]",
        "text-neutral-600",
        "dark:text-neutral-300",
        "truncate",
        "max-h-[70%]",
      ]),
    );
    expect(nameClass(sectionName)).not.toContain("flex-1");
    expect(nameClass(sectionName)).not.toContain("text-center");
    expect(labelClass(sectionLabel)).toEqual(
      expect.arrayContaining(["mt-auto", "text-[10px]", "[writing-mode:vertical-rl]", "rotate-180"]),
    );

    const item = renderStrip("Items", "Roof");
    expect(item.getAttribute("aria-label")).toBe("Items, Roof");
    expect(item.children[0]?.textContent).toBe("Roof");
    expect(item.children[1]?.textContent).toBe("Items");
    expect(nameClass(item.children[0])).not.toContain("flex-1");
    expect(labelClass(item.children[1])).toContain("mt-auto");
  });

  it("names a strip with no selection by its column alone", () => {
    expect(renderStrip("Sections", "").getAttribute("aria-label")).toBe("Sections");
  });

  it("records that the selection is pinned to the top of the strip", () => {
    const design = readFileSync(join(process.cwd(), "docs/spec/design.md"), "utf8");
    const collapsing = design.slice(design.indexOf("**Collapsing:**"), design.indexOf("**Comment detail**"));
    expect(collapsing).toMatch(/pinned to the top/);
  });
});

function nameClass(node: Element | undefined) {
  return node?.className.split(/\s+/) ?? [];
}

function labelClass(node: Element | undefined) {
  return node?.className.split(/\s+/) ?? [];
}
