import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { CollapseColumnsSwitch } from "@/app/sidebar/collapse-columns-switch";

const TIP = "Picking a Section or Item collapses its column.";

function renderSwitch(enabled: boolean) {
  const html = renderToStaticMarkup(createElement(CollapseColumnsSwitch, { enabled }));
  const node = new JSDOM(html).window.document.body.firstElementChild;
  if (!node) throw new Error("collapse columns switch rendered nothing");
  return node;
}

function classTokens(node: Element | null | undefined) {
  return node?.className.split(/\s+/) ?? [];
}

describe("collapse columns switch", () => {
  it("is a switch labelled Collapse columns, off until the cookie says on", () => {
    const off = renderSwitch(false);
    const toggle = off.querySelector("[role='switch']");
    expect(toggle?.getAttribute("type")).toBe("button");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(off.textContent).toContain("Collapse columns");
    expect(off.querySelector("[role='radio']")).toBeNull();
    expect(classTokens(toggle)).toEqual(expect.arrayContaining(["rounded-full"]));
    expect(classTokens(toggle).some((token) => token.startsWith("border"))).toBe(true);

    const on = renderSwitch(true);
    const filled = on.querySelector("[role='switch']");
    expect(filled?.getAttribute("aria-checked")).toBe("true");
    expect(classTokens(filled)).toEqual(expect.arrayContaining(["bg-neutral-900", "dark:bg-white", "rounded-full"]));
  });

  it("describes the behaviour from the info icon, on hover and keyboard focus, without a browser tooltip", () => {
    const block = renderSwitch(false);
    const info = block.querySelector("button[aria-describedby]");
    const tipId = info?.getAttribute("aria-describedby");
    const tip = tipId ? block.querySelector(`#${tipId}`) : null;
    expect(info?.getAttribute("type")).toBe("button");
    expect(info?.getAttribute("title")).toBeNull();
    expect(block.querySelector("[title]")).toBeNull();
    expect(tip?.getAttribute("role")).toBe("tooltip");
    expect(tip?.textContent).toBe(TIP);
    expect(classTokens(tip)).toEqual(
      expect.arrayContaining(["opacity-0", "group-hover/info:opacity-100", "group-focus-within/info:opacity-100"]),
    );
  });

  it("flips the switch and keeps the new choice after a remount", async () => {
    const dom = installSwitchDocument();
    const first = renderSwitchOn(dom, false);
    expect(dom.window.document.querySelector("[role='switch']")?.getAttribute("aria-checked")).toBe("false");
    const toggle = dom.window.document.querySelector("[role='switch']");
    if (!toggle) throw new Error("missing collapse columns switch");
    await act(async () => {
      toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(dom.window.document.querySelector("[role='switch']")?.getAttribute("aria-checked")).toBe("true");
    expect(dom.window.document.cookie).toContain("collapse-columns=on");
    await act(async () => {
      first.unmount();
    });

    const second = renderSwitchOn(dom, false);
    expect(dom.window.document.querySelector("[role='switch']")?.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      second.unmount();
      await new Promise((resolve) => setImmediate(resolve));
    });
    vi.unstubAllGlobals();
  });
});

function installSwitchDocument(): JSDOM {
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

function renderSwitchOn(dom: JSDOM, enabled: boolean): Root {
  const host = dom.window.document.getElementById("root");
  if (!host) throw new Error("collapse columns switch host missing");
  const root = createRoot(host);
  act(() => {
    root.render(createElement(CollapseColumnsSwitch, { enabled }));
  });
  return root;
}
