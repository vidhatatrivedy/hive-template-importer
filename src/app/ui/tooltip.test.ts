import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { Tooltip, tooltipPosition } from "@/app/ui/tooltip";

describe("tooltipPosition", () => {
  it("places the tooltip below the trigger when it fits", () => {
    expect(
      tooltipPosition({ top: 20, bottom: 40, left: 30 }, { width: 100, height: 40 }, { width: 800, height: 600 }),
    ).toEqual({ top: 44, left: 30 });
  });

  it("flips above the trigger and clamps to the viewport", () => {
    expect(
      tooltipPosition({ top: 500, bottom: 520, left: 2 }, { width: 100, height: 80 }, { width: 200, height: 540 }),
    ).toEqual({ top: 416, left: 8 });
    expect(
      tooltipPosition({ top: 20, bottom: 40, left: 180 }, { width: 100, height: 20 }, { width: 200, height: 600 }),
    ).toEqual({ top: 44, left: 92 });
  });
});

describe("Tooltip", () => {
  it("stays closed until hover or focus, and is absent from the server markup", () => {
    const html = renderToStaticMarkup(createElement(TooltipView, { id: "tip", content: "Picking a Section." }, tipButton()));
    const node = new JSDOM(html).window.document.body;
    expect(node.querySelector("[role='tooltip']")).toBeNull();
    expect(node.querySelector("[title]")).toBeNull();
    expect(node.textContent).toContain("More");
  });

  it("opens on hover and keyboard focus, closes on mouse-out, blur or Esc, and does not take focus", async () => {
    const dom = installDocument();
    const root = renderTooltip(dom, "Picking a Section or Item collapses its column.");
    const button = dom.window.document.querySelector("button");
    if (!button) throw new Error("tooltip trigger missing");

    expect(dom.window.document.querySelector("[role='tooltip']")).toBeNull();
    expect(button.getAttribute("title")).toBeNull();

    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }));
    });
    const hovered = dom.window.document.querySelector("[role='tooltip']");
    expect(hovered?.textContent).toBe("Picking a Section or Item collapses its column.");
    expect(hovered?.getAttribute("tabindex")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("tip");
    expect(hovered?.id).toBe("tip");
    expect(hovered?.className).toContain("text-[12px]");
    expect(hovered?.className).toContain("backdrop-blur-2xl");
    expect(dom.window.document.activeElement).not.toBe(hovered);

    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true }));
    });
    expect(dom.window.document.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => {
      button.focus();
    });
    expect(dom.window.document.querySelector("[role='tooltip']")?.textContent).toContain("collapses its column");
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

/** `createElement` does not treat a required `children` prop as its third argument. */
const TooltipView = Tooltip as unknown as (props: { id: string; content: string }) => ReactElement;

function tipButton(): ReactElement {
  return createElement("button", { type: "button" }, "More");
}

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

function renderTooltip(dom: JSDOM, content: string): Root {
  const host = dom.window.document.getElementById("root");
  if (!host) throw new Error("tooltip host missing");
  const root = createRoot(host);
  act(() => {
    root.render(createElement(TooltipView, { id: "tip", content }, tipButton()));
  });
  return root;
}
