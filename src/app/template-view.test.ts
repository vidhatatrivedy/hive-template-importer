import { describe, expect, it } from "vitest";
import { parseTemplateView, templateHref, type TemplateView } from "@/app/template-view";

const templateId = "6b1e0c3a-6e3d-4f3a-9c2e-1a2b3c4d5e6f";

function searchParamsFrom(href: string): Record<string, string | string[] | undefined> {
  const url = new URL(href, "http://example.test");
  return Object.fromEntries(url.searchParams.entries());
}

describe("Template URLs", () => {
  it("round-trips a view and always writes panes as trust,versions", () => {
    const view: TemplateView = {
      panes: new Set(["versions", "trust"]),
      row: 12,
    };
    const href = templateHref(templateId, view);
    expect(href).toBe(`/t/${templateId}?pane=trust,versions&row=12`);
    expect(parseTemplateView(searchParamsFrom(href))).toEqual(view);
    expect(templateHref(templateId, parseTemplateView({ pane: "trust,versions", row: "12" }))).toBe(href);
  });

  it("ignores unknown panes, non-integer rows and rows below 2", () => {
    expect(parseTemplateView({ pane: "report,trust,nope", row: "1" })).toEqual({
      panes: new Set(["trust"]),
      row: null,
    });
    expect(parseTemplateView({ pane: ["versions", "sidebar", "trust"], row: "abc" }).panes).toEqual(
      new Set(["versions", "trust"]),
    );
    expect(parseTemplateView({ row: "1" }).row).toBeNull();
    expect(parseTemplateView({ row: "0" }).row).toBeNull();
    expect(parseTemplateView({ row: "1.5" }).row).toBeNull();
    expect(parseTemplateView({ row: "2abc" }).row).toBeNull();
    expect(parseTemplateView({ row: "2" }).row).toBe(2);
  });

  it("omits empty params", () => {
    const empty: TemplateView = { panes: new Set(), row: null };
    expect(templateHref(templateId, empty)).toBe(`/t/${templateId}`);
    expect(templateHref(templateId, { panes: new Set(["versions"]), row: null })).toBe(
      `/t/${templateId}?pane=versions`,
    );
    expect(templateHref(templateId, { panes: new Set(), row: 4 })).toBe(`/t/${templateId}?row=4`);
    expect(parseTemplateView({ pane: "", row: "" })).toEqual(empty);
  });
});
