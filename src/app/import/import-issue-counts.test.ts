import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { ImportIssueCounts } from "@/app/import/import-screen";
import type { ImportReview } from "@/app/import/import-review";

const review = {
  issueCounts: { warning: 8, notice: 0 },
  warnings: {
    lines: ["Category missing · Roof › Covering › Flashing (row 2)", "Split run · File"],
    more: 2,
  },
  notices: { lines: [], more: 0 },
} satisfies Pick<ImportReview, "issueCounts" | "warnings" | "notices">;

describe("Import review issue counts", () => {
  it("lists warnings on hover and leaves a zero count without a tooltip", () => {
    const html = renderToStaticMarkup(createElement(ImportIssueCounts, { review }));
    const body = new JSDOM(html).window.document.body;
    const button = body.querySelector("button");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.textContent).toBe("8 warnings");
    expect(body.textContent).toContain("0 notices");
    expect(body.querySelectorAll("button")).toHaveLength(1);
    expect(body.querySelector("a")).toBeNull();
    expect(body.querySelector("[title]")).toBeNull();
    expect(body.querySelector("[role='tooltip']")).toBeNull();
  });

  it("shows six-capped lines and + n more from the keyboard, then hides them on Esc", async () => {
    const dom = installDocument();
    const host = dom.window.document.getElementById("root");
    if (!host) throw new Error("issue count host missing");
    const root = createRoot(host);
    act(() => {
      root.render(createElement(ImportIssueCounts, { review }));
    });
    const button = dom.window.document.querySelector("button");
    if (!(button instanceof dom.window.HTMLButtonElement)) throw new Error("warning count missing");

    await act(async () => {
      button.focus();
    });
    const tip = dom.window.document.querySelector("[role='tooltip']");
    expect(tip?.textContent).toContain("Category missing · Roof › Covering › Flashing (row 2)");
    expect(tip?.textContent).toContain("Split run · File");
    expect(tip?.textContent).toContain("+ 2 more");
    expect(tip?.querySelector("a")).toBeNull();
    expect(dom.window.document.activeElement).toBe(button);

    await act(async () => {
      button.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dom.window.document.querySelector("[role='tooltip']")).toBeNull();
    expect(dom.window.document.activeElement).toBe(button);

    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });
});

function installDocument(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost/",
  });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return dom;
}
