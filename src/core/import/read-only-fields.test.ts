import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { Cell } from "@/core/import/reconcile";
import type { ImportEvidence } from "@/core/import/schemas";
import { readOnlyFields } from "@/core/import/read-only-fields";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");
const BEN = "Ben Gromicko's Template for Home Inspections-2026-09-30.xls";

describe("readOnlyFields", () => {
  it("keeps Ben's default photos paired with their captions, in photo order, and drops empty cells", async () => {
    const fields = readOnlyFields(await evidenceOf(BEN));

    expect(fields[39]).toEqual({
      estimateMin: "10",
      estimateMax: "1000",
      lastModified: "09/30/2026 03:42:58",
      photos: [
        {
          url: "https://cdn.spectora.com/default_photos/images/005/647/344/original/headwall_flashing_internachi_ben_gromicko.jpg?1790761378",
          caption: "Flashing Details",
        },
      ],
    });
    expect(fields[38]).toEqual({
      estimateMin: "10",
      estimateMax: "1000",
      lastModified: "09/30/2026 03:42:58",
      photos: [
        {
          url: "https://cdn.spectora.com/default_photos/images/005/647/343/original/kickout_flashing_internachi_ben_gromicko.jpg?1790761378",
          caption: null,
        },
      ],
    });
  });

  it("keeps a Default Location's leading space as raw text", async () => {
    const fields = readOnlyFields(await evidenceOf(BEN));

    expect(fields[1131]?.defaultLocation).toBe(" Kitchen");
    expect(fields[1131]?.photos).toBeUndefined();
  });

  it("omits an empty Source row, blank cells, and a missing photo, and still pairs photos in number order", () => {
    const fields = readOnlyFields(
      evidence(
        [
          " default photo 2 ",
          "Default Photo 2 Caption",
          "DEFAULT PHOTO 1",
          "default photo 1 caption",
          "Default Location",
          "default estimate min",
          "Default Estimate Max",
          "Last Modified",
        ],
        [
          {
            rowNumber: 4,
            cells: [
              "https://cdn.example/second.jpg",
              "Second",
              "https://cdn.example/first.jpg",
              "First",
              " Kitchen",
              10,
              "",
              "   ",
            ],
          },
          {
            rowNumber: 5,
            cells: [null, null, null, "  ", null, null, null, null],
          },
        ],
      ),
    );

    expect(fields[4]).toEqual({
      defaultLocation: " Kitchen",
      estimateMin: "10",
      photos: [
        { url: "https://cdn.example/first.jpg", caption: "First" },
        { url: "https://cdn.example/second.jpg", caption: "Second" },
      ],
    });
    expect(fields[5]).toBeUndefined();
  });
});

async function evidenceOf(file: string): Promise<ImportEvidence> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}

function evidence(headers: string[], rows: { rowNumber: number; cells: Cell[] }[]): ImportEvidence {
  return {
    run: {
      filename: "hand.xls",
      sha256: "ab".repeat(32),
      byteSize: 1,
      sheetName: "Sheet1",
      headers,
      rowsRead: rows.length,
      blankRows: 0,
      valuesDecoded: 0,
    },
    sourceRows: rows,
    issues: [],
  };
}
