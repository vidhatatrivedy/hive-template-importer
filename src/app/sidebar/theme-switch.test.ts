import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { ThemeSwitch } from "@/app/sidebar/theme-switch";
import type { ThemeChoice } from "@/app/theme";

function renderSwitch(theme: ThemeChoice, revealed = false) {
  const html = renderToStaticMarkup(createElement(ThemeSwitch, { theme, revealed }));
  const node = new JSDOM(html).window.document.body.firstElementChild;
  if (!node) throw new Error("theme switch rendered nothing");
  return node;
}

function classTokens(node: Element) {
  return node.className.split(/\s+/);
}

describe("theme switch", () => {
  it("offers Light, Dark and System, with System filled when that is the choice", () => {
    const block = renderSwitch("system");
    const buttons = [...block.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Light", "Dark", "System"]);
    expect(buttons.map((button) => button.getAttribute("type"))).toEqual(["button", "button", "button"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(block.getAttribute("aria-label") === "Theme" || block.querySelector("[aria-label='Theme']")).toBeTruthy();
    expect(block.textContent).toContain("Theme");

    const [light, dark, system] = buttons;
    expect(classTokens(light!).some((token) => token.startsWith("border"))).toBe(true);
    expect(classTokens(dark!).some((token) => token.startsWith("border"))).toBe(true);
    expect(classTokens(system!)).toEqual(expect.arrayContaining(["bg-neutral-900", "dark:bg-white", "rounded-full"]));
    expect(classTokens(system!).some((token) => token.startsWith("border"))).toBe(false);
  });

  it("fills Light or Dark when that theme is forced", () => {
    const light = renderSwitch("light").querySelectorAll("button");
    expect(light[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(classTokens(light[0]!)).toContain("bg-neutral-900");
    expect(light[2]?.getAttribute("aria-pressed")).toBe("false");

    const dark = renderSwitch("dark").querySelectorAll("button");
    expect(dark[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(classTokens(dark[1]!)).toContain("bg-neutral-900");
    expect(dark[0]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("stays hidden in the closed strip and shows when the sidebar is expanded or the menu is open", () => {
    const closed = renderSwitch("system");
    expect(classTokens(closed)).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "pointer-events-none",
        "group-hover:opacity-100",
        "group-hover:pointer-events-auto",
        "group-focus-within:opacity-100",
        "group-focus-within:pointer-events-auto",
      ]),
    );

    const open = renderSwitch("system", true);
    expect(classTokens(open)).toContain("opacity-100");
    expect(classTokens(open)).not.toContain("opacity-0");
  });

  it("keeps the filled button when the switch remounts with the earlier server choice", async () => {
    const dom = installSwitchDocument();
    const first = renderSwitchOn(dom, "system");
    const dark = buttonNamed(dom, "Dark");
    await act(async () => {
      dark.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(pressedLabels(dom)).toEqual(["Dark"]);
    await act(async () => {
      first.unmount();
    });

    const second = renderSwitchOn(dom, "system");
    expect(pressedLabels(dom)).toEqual(["Dark"]);
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

function renderSwitchOn(dom: JSDOM, theme: ThemeChoice): Root {
  const host = dom.window.document.getElementById("root");
  if (!host) throw new Error("theme switch host missing");
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ThemeSwitch, { theme, revealed: true }));
  });
  return root;
}

function buttonNamed(dom: JSDOM, label: string): HTMLButtonElement {
  const button = [...dom.window.document.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!button) throw new Error(`missing ${label} button`);
  return button;
}

function pressedLabels(dom: JSDOM): string[] {
  return [...dom.window.document.querySelectorAll("button")]
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent ?? "");
}
