import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const CLIENT_ENTRY = path.join(SRC, "app/import/import-screen.tsx");
const SERVER_ONLY_PACKAGES = ["parse5", "read-excel-file", "entities"];

describe("the Comment HTML renderer", () => {
  it("doesn't load DOMPurify, the sanitiser or parse5 until the browser runs it", () => {
    const { modules, packages } = importGraph(path.join(SRC, "app/ui/comment-html.tsx"));
    const relative = [...modules].map((file) => path.relative(SRC, file));

    expect(relative).toContain("core/sanitise/purify-config.ts");
    expect(relative).not.toContain("core/sanitise/sanitise-comment-html.ts");
    expect(relative).not.toContain("core/sanitise/index.ts");
    expect([...packages].filter((specifier) => specifier === "dompurify" || specifier.startsWith("dompurify/"))).toEqual(
      [],
    );
    for (const name of SERVER_ONLY_PACKAGES) {
      expect([...packages].filter((specifier) => specifier === name || specifier.startsWith(`${name}/`))).toEqual([]);
    }
  });
});

describe("the editor", () => {
  it("runs Save preparation in the browser, and does not pull the Spectora parser", () => {
    const { modules, packages } = importGraph(path.join(SRC, "app/t/[templateId]/editor.tsx"));
    const relative = [...modules].map((file) => path.relative(SRC, file));

    expect(relative).toContain("app/editor/editor-state.ts");
    expect(relative).toContain("core/import/prepare-save.ts");
    expect(relative).toContain("core/sanitise/sanitise-comment-html.ts");
    expect(relative).toContain("app/ui/comment-html.tsx");
    expect(relative).toContain("app/editor/added-in-the-editor.ts");
    expect(relative).toContain("core/sanitise/purify-config.ts");
    expect(relative).not.toContain("app/source-row-view.ts");
    expect(relative).not.toContain("core/import/parse-spectora-export.ts");
    expect(packages.has("parse5")).toBe(true);
    for (const name of ["read-excel-file", "entities"]) {
      expect([...packages].filter((specifier) => specifier === name || specifier.startsWith(`${name}/`))).toEqual([]);
    }
  });
});

describe("the import screen's client bundle", () => {
  it("doesn't pull in the parser, parse5 or read-excel-file", () => {
    const { modules, packages } = importGraph(CLIENT_ENTRY);
    const relative = [...modules].map((file) => path.relative(SRC, file));

    expect(relative).toContain("core/import/import-errors.ts");
    expect(relative).toContain("app/import/actions.ts");
    expect(relative).not.toContain("core/import/parse-spectora-export.ts");
    expect(relative.filter((file) => file.startsWith("core/sanitise/"))).toEqual([]);
    expect(relative).not.toContain("core/import/index.ts");
    for (const name of SERVER_ONLY_PACKAGES) {
      expect([...packages].filter((specifier) => specifier === name || specifier.startsWith(`${name}/`))).toEqual([]);
    }
  });
});

/**
 * Follows value imports (not `import type`) from a module through `src/`. A `"use server"`
 * module reaches the browser as a reference to its actions, so its own imports aren't followed.
 */
function importGraph(entry: string): { modules: Set<string>; packages: Set<string> } {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || modules.has(file)) continue;
    modules.add(file);
    const source = fs.readFileSync(file, "utf8");
    if (/^["']use server["']/.test(source)) continue;
    for (const match of source.matchAll(/^(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const local = resolveLocal(file, specifier);
      if (local) pending.push(local);
      else if (!specifier.startsWith(".") && !specifier.startsWith("@/")) packages.add(specifier);
    }
  }
  return { modules, packages };
}

function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Can't resolve ${specifier} from ${from}`);
}
