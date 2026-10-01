import { describe, expect, it } from "vitest";
import type { TemplateDetail, TemplateSummary } from "@/db/schemas";
import { copyHeaderLine, reportLabels, resolveReportBase } from "@/app/report-base";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_V1 = "22222222-2222-4222-8222-222222222222";
const IMPORT_LATEST = "99999999-9999-4999-8999-999999999999";
const COPY_ID = "33333333-3333-4333-8333-333333333333";
const COPY_V1 = "44444444-4444-4444-8444-444444444444";
const COPY2_ID = "55555555-5555-4555-8555-555555555555";
const COPY2_V1 = "66666666-6666-4666-8666-666666666666";
const BLANK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BLANK_V1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("resolveReportBase", () => {
  it("uses an imported Template's own Version 1", () => {
    const detail = imported();
    expect(resolveReportBase(detail, [summaryOf(detail)])).toEqual({
      kind: "own-import",
      versionId: IMPORT_V1,
    });
  });

  it("points a Copy at the imported Template while that Template exists", () => {
    expect(resolveReportBase(copyOfImport(), [importedSummary()])).toEqual({
      kind: "source-import",
      templateId: IMPORT_ID,
      templateName: "Residential",
    });
  });

  it("points a Copy of a Copy at the same original import", () => {
    const intermediate = copyOfImport();
    expect(resolveReportBase(copyOfCopy(), [importedSummary(), summaryOf(intermediate)])).toEqual({
      kind: "source-import",
      templateId: IMPORT_ID,
      templateName: "Residential",
    });
  });

  it("is unverifiable against this Copy's Version 1 once the imported Template is deleted", () => {
    expect(resolveReportBase(copyOfImport(), [summaryOf(copyOfImport())])).toEqual({
      kind: "unverifiable",
      versionId: COPY_V1,
    });
  });

  it("is none for a Blank Template and for a Copy of a Blank", () => {
    expect(resolveReportBase(blank(), [])).toEqual({ kind: "none" });
    expect(resolveReportBase(copyOfBlank(), [summaryOf(blank())])).toEqual({ kind: "none" });
  });
});

describe("copyHeaderLine", () => {
  it("names the Template and Version a Copy came from", () => {
    expect(
      copyHeaderLine({ templateId: IMPORT_ID, templateName: "Residential", versionNumber: 3 }),
    ).toBe("Copy of 'Residential' v3");
  });

  it("marks the source deleted when its id is gone", () => {
    expect(copyHeaderLine({ templateId: null, templateName: "Residential", versionNumber: 3 })).toBe(
      "Copy of 'Residential' v3 (deleted)",
    );
  });

  it("is absent when the Template was not copied", () => {
    expect(copyHeaderLine(null)).toBeNull();
  });
});

describe("reportLabels", () => {
  const copied = { templateId: COPY_ID, templateName: "Residential", versionNumber: 3 };
  const copiedDeleted = { templateId: null, templateName: "Residential", versionNumber: 3 };

  it("says nothing on an import still at Version 1, and names the later Version once it has moved on", () => {
    const base = { kind: "own-import" as const, versionId: IMPORT_V1 };
    expect(reportLabels(base, 1, null)).toEqual({
      movedOn: null,
      readOnly: null,
      unverifiable: null,
      copiedFrom: null,
    });
    expect(reportLabels(base, 2, null).movedOn).toBe(
      "Describes Version 1, as imported. This Template is now at Version 2.",
    );
  });

  it("labels a Copy's report as the import's Version 1, read-only, and where it was copied from", () => {
    const labels = reportLabels(
      { kind: "source-import", templateId: IMPORT_ID, templateName: "Residential" },
      4,
      copied,
    );
    expect(labels.movedOn).toBeNull();
    expect(labels.unverifiable).toBeNull();
    expect(readOnlySentence(labels.readOnly)).toBe(
      "Read-only. This is the import report of 'Residential', Version 1.",
    );
    expect(labels.readOnly?.templateId).toBe(IMPORT_ID);
    expect(labels.copiedFrom).toBe("Copied from 'Residential', Version 3.");
  });

  it("says a deleted source on the copied-from line", () => {
    const labels = reportLabels(
      { kind: "source-import", templateId: IMPORT_ID, templateName: "Residential" },
      1,
      copiedDeleted,
    );
    expect(labels.copiedFrom).toBe("Copied from 'Residential' (deleted), Version 3.");
  });

  it("explains that a deleted import cannot be re-verified, and still says where the Copy came from", () => {
    const labels = reportLabels({ kind: "unverifiable", versionId: COPY_V1 }, 2, copiedDeleted);
    expect(labels.movedOn).toBeNull();
    expect(labels.readOnly).toBeNull();
    expect(labels.unverifiable).toBe(
      "The Template this file was imported as has been deleted, so its rows can't be re-verified. Issues and locations below refer to this Copy's Version 1.",
    );
    expect(labels.copiedFrom).toBe("Copied from 'Residential' (deleted), Version 3.");
  });
});

function readOnlySentence(
  readOnly: { before: string; templateName: string; after: string } | null,
): string | null {
  if (!readOnly) return null;
  return `${readOnly.before}${readOnly.templateName}${readOnly.after}`;
}

function imported(): TemplateDetail {
  return detail({
    id: IMPORT_ID,
    name: "Residential",
    creation: "import",
    importRun: run(),
    latest: version(IMPORT_V1, 1),
    versions: [versionSummary(IMPORT_LATEST, 3, "save"), versionSummary(IMPORT_V1, 1, "import")],
  });
}

function copyOfImport(): TemplateDetail {
  return detail({
    id: COPY_ID,
    name: "Residential (copy)",
    creation: "copy",
    copiedFrom: { templateId: IMPORT_ID, templateName: "Residential", versionNumber: 3 },
    importRun: run(),
    latest: version("77777777-7777-4777-8777-777777777777", 2),
    versions: [
      versionSummary("77777777-7777-4777-8777-777777777777", 2, "save"),
      versionSummary(COPY_V1, 1, "copy"),
    ],
  });
}

function copyOfCopy(): TemplateDetail {
  return detail({
    id: COPY2_ID,
    name: "Residential (copy) (copy)",
    creation: "copy",
    copiedFrom: { templateId: COPY_ID, templateName: "Residential (copy)", versionNumber: 1 },
    importRun: run(),
    latest: version(COPY2_V1, 1),
    versions: [versionSummary(COPY2_V1, 1, "copy")],
  });
}

function blank(): TemplateDetail {
  return detail({
    id: BLANK_ID,
    name: "Untitled",
    creation: "blank",
    latest: version(BLANK_V1, 1),
    versions: [versionSummary(BLANK_V1, 1, "blank")],
  });
}

function copyOfBlank(): TemplateDetail {
  return detail({
    id: COPY_ID,
    name: "Untitled (copy)",
    creation: "copy",
    copiedFrom: { templateId: BLANK_ID, templateName: "Untitled", versionNumber: 1 },
    latest: version(COPY_V1, 1),
    versions: [versionSummary(COPY_V1, 1, "copy")],
  });
}

function importedSummary(): TemplateSummary {
  return summaryOf(imported());
}

function summaryOf(template: TemplateDetail): TemplateSummary {
  return {
    id: template.id,
    name: template.name,
    creation: template.creation,
    copiedFromName: template.copiedFrom?.templateName ?? null,
    importRun: template.importRun
      ? {
          id: template.importRun.id,
          filename: template.importRun.filename,
          sha256: template.importRun.sha256,
          importedAt: template.importRun.importedAt,
        }
      : null,
    latest: template.latest,
  };
}

function detail(overrides: Partial<TemplateDetail> & Pick<TemplateDetail, "id" | "name" | "creation">): TemplateDetail {
  return {
    createdAt: "2026-09-30T00:00:00.000Z",
    copiedFrom: null,
    importRun: null,
    latest: version(BLANK_V1, 1),
    versions: [],
    ...overrides,
  };
}

function run(): NonNullable<TemplateDetail["importRun"]> {
  return {
    id: RUN,
    filename: "Residential.xls",
    sha256: "ab".repeat(32),
    importedAt: "2026-09-30T00:00:00.000Z",
    byteSize: 100,
  };
}

function version(id: string, number: number): TemplateDetail["latest"] {
  return { id, number, savedAt: "2026-09-30T00:00:00.000Z" };
}

function versionSummary(
  id: string,
  number: number,
  origin: TemplateDetail["versions"][number]["origin"],
): TemplateDetail["versions"][number] {
  return {
    id,
    number,
    savedAt: "2026-09-30T00:00:00.000Z",
    origin,
    restoredFromNumber: null,
    counts: { sections: 1, items: 1, comments: 1 },
  };
}
