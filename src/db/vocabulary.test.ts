import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { issueClasses, issueKinds, issueSeverities } from "@/core/import/catalogue";
import { answerTypes, commentTypes, optionLists } from "@/core/import/schemas";
import { cutKinds } from "@/core/sanitise";
import { versionOrigins } from "@/db/schemas";
import { vocabularyDrift, type MigrationSource } from "@/db/vocabulary";

function readMigrations(): MigrationSource[] {
  const directory = join(process.cwd(), "supabase/migrations");
  return readdirSync(directory)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => ({
      filename,
      sql: readFileSync(join(directory, filename), "utf8"),
    }));
}

describe("vocabulary drift", () => {
  it("compares the last definition of a check, and keeps one a later migration leaves alone", () => {
    const sources: MigrationSource[] = [
      {
        filename: "1.sql",
        sql: `
          constraint import_issues_kind_check check (kind = any (array['kept', 'dropped']::text[]));
          constraint comments_comment_type_check check (comment_type = any (array['info', 'limit', 'defect']::text[]));
        `,
      },
      {
        filename: "2.sql",
        sql: `
          alter table public.import_issues drop constraint import_issues_kind_check;
          alter table public.import_issues
            add constraint import_issues_kind_check check (kind = any (array['added', 'kept']::text[]));
        `,
      },
    ];

    expect(
      vocabularyDrift(sources, {
        import_issues_kind_check: ["kept", "added"],
        comments_comment_type_check: ["defect", "info", "limit"],
      }),
    ).toEqual([]);
  });

  it("fails when core has a kind no migration allows", () => {
    expect(
      vocabularyDrift(
        [
          {
            filename: "1.sql",
            sql: `constraint import_issues_kind_check check (kind = any (array['blank-name']::text[]));`,
          },
        ],
        { import_issues_kind_check: ["blank-name", "split-run"] },
      ),
    ).toEqual([
      {
        constraint: "import_issues_kind_check",
        missingFromDatabase: ["split-run"],
        missingFromCore: [],
      },
    ]);
  });

  it("fails when a migration allows a kind core does not export", () => {
    expect(
      vocabularyDrift(
        [
          {
            filename: "1.sql",
            sql: `constraint import_issues_kind_check check (kind = any (array['blank-name', 'retired']::text[]));`,
          },
        ],
        { import_issues_kind_check: ["blank-name"] },
      ),
    ).toEqual([
      {
        constraint: "import_issues_kind_check",
        missingFromDatabase: [],
        missingFromCore: ["retired"],
      },
    ]);
  });

  it("fails when a migration drops a kind core still has", () => {
    expect(
      vocabularyDrift(
        [
          {
            filename: "1.sql",
            sql: `constraint import_issues_kind_check check (kind = any (array['blank-name', 'split-run']::text[]));`,
          },
          {
            filename: "2.sql",
            sql: `
              alter table public.import_issues drop constraint import_issues_kind_check;
              alter table public.import_issues
                add constraint import_issues_kind_check check (kind = any (array['blank-name']::text[]));
            `,
          },
        ],
        { import_issues_kind_check: ["split-run", "blank-name"] },
      ),
    ).toEqual([
      {
        constraint: "import_issues_kind_check",
        missingFromDatabase: ["split-run"],
        missingFromCore: [],
      },
    ]);
  });

  it("matches the committed migrations to the arrays core and src/db export", () => {
    expect(
      vocabularyDrift(readMigrations(), {
        import_issues_kind_check: issueKinds,
        import_issues_severity_check: issueSeverities,
        import_issues_class_check: issueClasses,
        html_cuts_kind_check: cutKinds,
        comments_comment_type_check: commentTypes,
        comments_answer_type_check: answerTypes,
        comment_options_list_check: optionLists,
        versions_origin_check: versionOrigins,
      }),
    ).toEqual([]);
  });
});
