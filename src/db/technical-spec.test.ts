import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const spec = readFileSync(join(process.cwd(), "docs/spec/technical.md"), "utf8");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  return readdirSync(directory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => readFileSync(join(directory, filename), "utf8"))
    .join("\n");
}

/** Latest `create or replace` for a public function, through its closing `$fn$;`. */
function functionSource(sql: string, functionName: string): string {
  const pattern = new RegExp(
    `create or replace function public\\.${functionName}\\b[\\s\\S]*?\\$fn\\$;`,
    "g",
  );
  const source = [...sql.matchAll(pattern)].at(-1)?.[0];
  if (source === undefined) throw new Error(`missing function public.${functionName}`);
  return source;
}

function languageOf(source: string): string {
  const language = /\nlanguage (sql|plpgsql)\n/.exec(source)?.[1];
  if (language === undefined) throw new Error("function has no language clause");
  return language;
}

function dbResetScript(packageJson: string): string {
  const parsed: unknown = JSON.parse(packageJson);
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
    throw new Error("package.json is missing scripts");
  }
  const script = parsed.scripts["db:reset"];
  if (typeof script !== "string") throw new Error("package.json is missing scripts.db:reset");
  return script;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("technical.md records what slice 3 settled", () => {
  it("names the SQLSTATE codes src/db maps, including the unique-violation backstop", () => {
    const db = readRepoFile("src/db/index.ts");
    expect(db).toContain('const TEMPLATE_NOT_FOUND = "PT404"');
    expect(db).toContain('const STALE_BASE = "PT409"');
    expect(db).toContain('const FOREIGN_SOURCE_ROW = "PT422"');
    expect(db).toContain('const UNIQUE_VIOLATION = "23505"');
    expect(db).toContain('const VERSION_NUMBER_CONSTRAINT = "versions_template_id_number_key"');
    expect(db).toContain('const VERSION_NUMBER_COLUMNS = "(template_id, number)"');

    expect(spec).toContain("`PT404` is `template-not-found`");
    expect(spec).toContain("`PT409` is `stale-base`");
    expect(spec).toContain("`PT422` is `foreign-source-row`");
    expect(spec).toContain("`23505` on `versions (template_id, number)`");
    expect(spec).toContain("raise `P0001` and throw");

    const sql = migrationSql();
    expect(sql).toContain("errcode = 'PT404'");
    expect(sql).toContain("errcode = 'PT409'");
    expect(sql).toContain("errcode = 'PT422'");
    expect(sql).toContain("errcode = 'P0001'");
  });

  it("records that db reset --db-url is the reset that shipped", () => {
    const script = dbResetScript(readRepoFile("package.json"));
    expect(script).toContain("db reset --db-url");
    expect(script).toContain("--yes");
    expect(script).toContain("--no-seed");
    expect(spec).toContain("`supabase db reset --db-url` with `--yes` and `--no-seed`");
  });

  it("records that Ben needed no statement-timeout change", () => {
    expect(migrationSql()).not.toContain("statement_timeout");
    expect(spec).toContain("No migration sets `statement_timeout`");
  });

  it("records which reads are language sql, and how list and get_template are shaped", () => {
    const sql = migrationSql();
    for (const name of ["list_templates", "get_version_tree", "get_import_evidence"] as const) {
      expect(languageOf(functionSource(sql, name))).toBe("sql");
    }

    const list = functionSource(sql, "list_templates");
    expect(list).toContain("order by listed.saved_at desc, listed.created_at desc, listed.id asc");
    expect(list).not.toContain("'createdAt'");

    const detail = functionSource(sql, "get_template");
    expect(detail).toContain("'createdAt'");
    expect(detail).toContain("'copiedFrom'");

    expect(spec).toContain(
      "`list_templates`, `get_version_tree` and `get_import_evidence` are `language sql`",
    );
    expect(spec).toContain(
      "Sorted by last Save (`latest.savedAt` desc), then `created_at` desc, then id. `createdAt` is not in the summary.",
    );
    expect(spec).toContain("id, name, `createdAt`, `creation`, `copiedFrom`");
  });

  it("records that seed checks the one Template and prints the verify table", () => {
    const seed = readRepoFile("scripts/seed.ts");
    expect(seed).toContain("templates.length !== 1");
    expect(seed).toContain("draft.suggestedName");
    expect(seed).toContain("formatVerifyTable");
    expect(spec).toContain("exactly that one Template under its suggested name");
    expect(spec).toContain("printing the `verify` table for it (a header and one row)");
  });
});
