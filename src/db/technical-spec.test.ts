import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const spec = readFileSync(join(process.cwd(), "docs/spec/technical.md"), "utf8");

/** Refusal codes `src/db` maps, in the order the adapter declares them. */
function refusalCodes(source: string): string[] {
  return [...source.matchAll(/const \w+ = "((?:PT\d{3})|23505)"/g)].map((match) => match[1] ?? "");
}

describe("technical.md records what slice 3 settled", () => {
  it("names the SQLSTATE codes src/db maps, including the unique-violation backstop", () => {
    const codes = refusalCodes(readFileSync(join(process.cwd(), "src/db/index.ts"), "utf8"));
    expect(codes).toEqual(["PT404", "PT409", "PT422", "23505"]);
    for (const code of codes) expect(spec).toContain(code);
  });

  it("records that db reset --db-url is the reset that shipped", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: { "db:reset": string };
    };
    expect(pkg.scripts["db:reset"]).toContain("db reset --db-url");
    expect(spec).toContain("db reset --db-url");
  });

  it("records that Ben needed no statement-timeout change", () => {
    const directory = join(process.cwd(), "supabase/migrations");
    const sql = readdirSync(directory)
      .filter((filename) => filename.endsWith(".sql"))
      .map((filename) => readFileSync(join(directory, filename), "utf8"))
      .join("\n");
    expect(sql).not.toContain("statement_timeout");
    expect(spec).toContain("No migration sets `statement_timeout`");
  });
});
