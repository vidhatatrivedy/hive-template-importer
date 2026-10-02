import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { CollapsingColumn } from "@/app/ui/collapsing-column";
import { ColumnStrip } from "@/app/ui/column-strip";

function renderColumn(collapsed: boolean) {
  const html = renderToStaticMarkup(
    <CollapsingColumn
      collapsed={collapsed}
      strip={<ColumnStrip title="Sections" stripText="Roof" onFocus={() => {}} />}
    >
      <ul>
        <li>Roof covering</li>
      </ul>
    </CollapsingColumn>,
  );
  const node = new JSDOM(html).window.document.body.firstElementChild;
  if (!node) throw new Error("collapsing column rendered nothing");
  return node;
}

function classTokens(node: Element | null | undefined) {
  return node?.className.split(/\s+/) ?? [];
}

describe("collapsing column", () => {
  it("eases the width between the open column and the strip without unmounting the list", () => {
    const open = renderColumn(false);
    expect(classTokens(open)).toEqual(
      expect.arrayContaining([
        "w-56",
        "overflow-hidden",
        "transition-[width]",
        "duration-200",
        "ease-out",
        "motion-reduce:transition-none",
      ]),
    );
    expect(classTokens(open)).not.toContain("w-9");

    const openList = open.querySelector("ul");
    const openContent = openList?.parentElement;
    const openStrip = open.querySelector("button")?.parentElement;
    expect(openList?.textContent).toBe("Roof covering");
    expect(classTokens(openContent)).toEqual(
      expect.arrayContaining([
        "w-56",
        "opacity-100",
        "transition-opacity",
        "duration-200",
        "ease-out",
        "motion-reduce:transition-none",
      ]),
    );
    expect(openContent?.hasAttribute("inert")).toBe(false);
    expect(open.querySelector("button")?.getAttribute("aria-label")).toBe("Sections, Roof");
    expect(classTokens(openStrip)).toEqual(
      expect.arrayContaining(["opacity-0", "pointer-events-none", "transition-opacity"]),
    );
    expect(openStrip?.hasAttribute("inert")).toBe(true);

    const collapsed = renderColumn(true);
    expect(classTokens(collapsed)).toEqual(
      expect.arrayContaining([
        "w-9",
        "overflow-hidden",
        "duration-200",
        "ease-out",
        "motion-reduce:transition-none",
      ]),
    );
    expect(classTokens(collapsed)).not.toContain("w-56");
    const collapsedList = collapsed.querySelector("ul");
    const collapsedContent = collapsedList?.parentElement;
    const collapsedStrip = collapsed.querySelector("button")?.parentElement;
    expect(collapsedList?.textContent).toBe("Roof covering");
    expect(classTokens(collapsedContent)).toEqual(
      expect.arrayContaining(["w-56", "opacity-0", "pointer-events-none"]),
    );
    expect(collapsedContent?.hasAttribute("inert")).toBe(true);
    expect(classTokens(collapsedStrip)).toContain("opacity-100");
    expect(collapsedStrip?.hasAttribute("inert")).toBe(false);
  });

  it("records the width transition and the reduced-motion rule", () => {
    const design = readFileSync(join(process.cwd(), "docs/spec/design.md"), "utf8");
    const collapsing = design.slice(design.indexOf("**Collapsing:**"), design.indexOf("**Comment detail**"));
    expect(collapsing).toMatch(/200ms/);
    expect(collapsing).toMatch(/reduced motion/i);
  });
});
