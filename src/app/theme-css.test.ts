import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

describe("dark variant", () => {
  it("follows the system unless data-theme forces light or dark", async () => {
    const source = `${readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")}\n@source inline("dark:bg-black");\n`;
    const result = await postcss([tailwindcss()]).process(source, { from: join(process.cwd(), "src/app/globals.css") });
    const css = result.css;
    expect(css).toContain('.dark\\:bg-black:where([data-theme="dark"], [data-theme="dark"] *)');
    expect(css).toContain(
      '.dark\\:bg-black:where(:not([data-theme="light"], [data-theme="light"] *))',
    );
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/);
    expect(css).toContain("--background: #0a0a0a");
    expect(css).toContain("--background: #ffffff");
  });
});
