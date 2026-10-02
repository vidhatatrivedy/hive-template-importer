import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("theme spec", () => {
  it("defaults to System and keeps the settings block at the bottom of the sidebar", () => {
    const design = readFileSync(join(process.cwd(), "docs/spec/design.md"), "utf8");
    const sidebar = design.slice(design.indexOf("**Template sidebar:**"), design.indexOf("**Editor window:**"));
    const colour = design.slice(design.indexOf("**Colour:**"), design.indexOf("**Type:**"));
    expect(sidebar).toMatch(/settings block/);
    expect(sidebar).toMatch(/bottom/);
    expect(colour).toMatch(/defaults to System/);
    expect(colour).toMatch(/sidebar/);
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('position: "bottom-right"');
  });
});
