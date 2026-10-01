import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { EditableTree, ImportDraft } from "@/core/import/schemas";
import { buildTrustReport } from "@/core/import/trust-report";
import { trustSectionsView } from "@/app/trust-sections";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/spectora");
const RESIDENTIAL = "InterNACHI Residential -2026-09-30.xls";
const RESIDENTIAL_TEMPLATE = "Residential Template-2026-09-30.xls";
const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";
const RADON = "Radon Inspection-2026-09-30.xls";

const MISSING_FROM_EXPORT = [
  "empty Sections and Items",
  "Section and Item settings",
  "template attachments",
  "the template name",
  "recommendation labels",
  "default photos as files",
];

describe("trustSectionsView", () => {
  it("puts Residential's Dev Item first under Inspection Details", async () => {
    const draft = await draftOf(RESIDENTIAL_TEMPLATE);
    const details = trustSectionsView(buildTrustReport(draft, draft.tree)).reconciliation[0];

    expect(details?.row).toEqual({
      name: "Inspection Details",
      mark: null,
      counts: "9 source rows · 9 stored Comments · 2 Items · 1 issue",
      status: "✓",
    });
    expect(details?.items.map((item) => item.name)).toEqual(["Dev", "General"]);
    expect(details?.items[0]).toEqual({
      name: "Dev",
      mark: null,
      counts: "3 source rows · 3 stored Comments · 0 issues",
      status: "✓",
    });
  });

  it("shows Radon's 2 Sections and 3 Items, and the Missing-from-export block even at zero", async () => {
    const draft = await draftOf(RADON);
    const view = trustSectionsView(buildTrustReport(draft, draft.tree));

    expect(view.reconciliation).toHaveLength(2);
    expect(
      view.reconciliation.map((section) => ({
        name: section.row.name,
        items: section.items.map((item) => item.name),
      })),
    ).toEqual([
      { name: "Details", items: ["General", "Monitor Type"] },
      { name: "Radon", items: ["Summary"] },
    ]);
    expect(view.reconciliation.reduce((total, section) => total + section.items.length, 0)).toBe(3);
    expect(view.missingFromExport).toEqual({
      entries: MISSING_FROM_EXPORT,
      counts: [
        { title: "Expected column missing", count: 0 },
        { title: "Empty YouTube wrapper", count: 0 },
      ],
    });
    expect(view.externalAssets).toEqual({
      empty: "No External assets.",
      note: null,
      hosts: [],
    });
  });

  it("lists Ben's External assets by host, each URL with its Source rows, and kept columns", async () => {
    const draft = await draftOf(BEN);
    const view = trustSectionsView(buildTrustReport(draft, draft.tree));

    expect(view.externalAssets.empty).toBeNull();
    expect(view.externalAssets.note).toBe(
      "These load from another host and may stop loading once you leave Spectora.",
    );
    expect(view.externalAssets.hosts.map((host) => host.host)).toEqual(["cdn.spectora.com", "www.youtube.com"]);
    expect(view.externalAssets.hosts[0]?.urls).toEqual([
      { sourceRows: [8], url: "https://cdn.spectora.com/editor_assets/images/000/014/173/original/home_maintenance_book_gromicko.jpg?1556308325" },
      { sourceRows: [9], url: "https://cdn.spectora.com/editor_assets/images/000/014/172/original/annual_home_maintenance_inspection.jpg?1556308231" },
      { sourceRows: [10], url: "https://cdn.spectora.com/editor_assets/images/000/009/226/original/Screen_Shot_2019-02-07_at_12.48.56_PM.png?1549568949" },
      { sourceRows: [11], url: "https://cdn.spectora.com/editor_assets/images/000/009/227/original/Screen_Shot_2019-02-07_at_12.52.02_PM.png?1549569256" },
      { sourceRows: [12], url: "https://cdn.spectora.com/editor_assets/images/000/552/128/original/1732195077021.jpg?1732195077" },
      { sourceRows: [46], url: "https://cdn.spectora.com/editor_assets/images/000/009/228/original/Screen_Shot_2019-02-07_at_1.01.53_PM.png?1549569734" },
      { sourceRows: [77], url: "https://cdn.spectora.com/editor_assets/images/000/552/374/original/Screenshot_2024-11-21_at_6.05.17%E2%80%AFPM.png?1732230349" },
      { sourceRows: [78], url: "https://cdn.spectora.com/editor_assets/images/000/552/373/original/Screenshot_2024-11-21_at_6.03.33%E2%80%AFPM.png?1732230225" },
      { sourceRows: [85], url: "https://cdn.spectora.com/editor_assets/images/000/552/375/original/Screenshot_2024-11-21_at_6.09.39%E2%80%AFPM.png?1732230589" },
      { sourceRows: [86], url: "https://cdn.spectora.com/editor_assets/images/000/552/376/original/Screenshot_2024-11-21_at_6.09.39%E2%80%AFPM.png?1732230612" },
      { sourceRows: [111], url: "https://cdn.spectora.com/editor_assets/images/000/014/542/original/chimney_interior_deterioration_water.jpg?1556747519" },
      { sourceRows: [115], url: "https://cdn.spectora.com/editor_assets/images/000/014/541/original/chimney_clearances.jpg?1556747384" },
      { sourceRows: [116], url: "https://cdn.spectora.com/editor_assets/images/000/014/540/original/chimney_clearances.jpg?1556747308" },
    ]);
    expect(view.externalAssets.hosts[1]?.urls).toEqual([
      { sourceRows: [10], url: "https://www.youtube.com/embed/_ErxoNiGyzI" },
      { sourceRows: [10], url: "https://www.youtube.com/embed/5pQpMt8_zx8" },
    ]);
    expect(view.keptButNotUsed.note).toBe("Kept in each Source row, not shown in the editor.");
    expect(view.keptButNotUsed.columns.find((column) => column.column === "Default photos")).toEqual({
      column: "Default photos",
      rowsHoldingContent: 18,
    });
  });

  it("marks the later Item of a split run, as the samples workbook's reconciliation will", async () => {
    const bytes = await writeXlsxFile([
      ["Section Name", "Item Name", "Comment Name", "Comment Text", "Comment Type (info, limit, defect)"],
      ["Roof", "Covering", "Shingles", "", "info"],
      ["Roof", "Flashing", "Drip edge", "", "info"],
      ["Roof", "Covering", "Underlayment", "", "info"],
    ]).toBuffer();
    const result = await parseSpectoraExport(bytes, "samples-split-run.xls");
    if (!result.ok) throw new Error(result.rejection.kind);
    const roof = trustSectionsView(buildTrustReport(result.draft, result.draft.tree)).reconciliation[0];

    expect(roof?.row.mark).toBeNull();
    expect(roof?.items.map((item) => ({ name: item.name, mark: item.mark }))).toEqual([
      { name: "Covering", mark: null },
      { name: "Flashing", mark: null },
      { name: "Covering", mark: "split run" },
    ]);
  });

  it("shows a Section's ✗ from the report and leaves an unaffected Section ✓", async () => {
    const draft = await draftOf(RESIDENTIAL);
    const tree = structuredClone(draft.tree);
    const cracking = commentOn(tree, 10);
    expect(cracking.name).toBe("Cracking - Major");
    cracking.textHtml = `${cracking.textHtml}x`;
    const view = trustSectionsView(buildTrustReport(draft, tree));

    expect(view.reconciliation.find((section) => section.row.name === "Inspection Details")?.row.status).toBe("✓");
    const exterior = view.reconciliation.find((section) => section.row.name === "Exterior");
    expect(exterior?.row.status).toBe("✗");
    expect(exterior?.items.find((item) => item.name === "Siding, Flashing & Trim")?.status).toBe("✗");
  });
});

function commentOn(tree: EditableTree, sourceRow: number) {
  for (const section of tree.sections) {
    for (const item of section.items) {
      const found = item.comments.find((comment) => comment.sourceRow === sourceRow);
      if (found) return found;
    }
  }
  throw new Error(`No Comment for Source row ${sourceRow}`);
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
