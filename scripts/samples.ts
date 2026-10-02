import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import writeXlsxFile from "write-excel-file/node";

/** Gitignored folder `npm run samples` fills for the hand checklist and the demo. */
export const SAMPLES_DIR = "samples";

/** Verbatim Spectora header, in file order. Same list the parser expects. */
const HEADERS = [
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Unit Type Options (numeric answers only, comma-separated)",
  "Recommendation (from list)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
  "Default Value",
  'Default Value 2 (for "range" types)',
  'Default Unit Type (for "number" and "range" types)',
  "Default Location",
  "Default Estimate Min",
  "Default Estimate Max",
  "Locked",
  "Simple Format",
  "Disable Photos",
  "Uses",
  "Default Photo 1",
  "Default Photo 1 Caption",
  "Default Photo 2",
  "Default Photo 2 Caption",
  "Default Photo 3",
  "Default Photo 3 Caption",
  "Default Photo 4",
  "Default Photo 4 Caption",
  "Default Photo 5",
  "Default Photo 5 Caption",
  "Default Photo 6",
  "Default Photo 6 Caption",
  "Default Photo 7",
  "Default Photo 7 Caption",
  "Default Photo 8",
  "Default Photo 8 Caption",
  "Default Photo 9",
  "Default Photo 9 Caption",
  "Default Photo 10",
  "Default Photo 10 Caption",
  "Last Modified",
];

const COMMENT_TYPE = "Comment Type (info, limit, defect)";
const FIVE_MB = 5 * 1024 * 1024;

/**
 * Writes the rejection and edge-case files the checklist uploads.
 * The synthetic-workbook helpers in the parser tests are not exported, so these
 * files are built here with write-excel-file.
 */
export async function writeSampleFiles(directory: string): Promise<void> {
  fs.mkdirSync(directory, { recursive: true });

  await writeFile(directory, "no-data-rows.xls", await writeXlsxFile([HEADERS]).toBuffer());

  const missingHeaders = HEADERS.filter((header) => header !== "Item Name" && header !== COMMENT_TYPE);
  const missingRow = missingHeaders.map((header) => {
    if (header === "Section Name") return "Roof";
    if (header === "Comment Name") return "Shingles";
    if (header === "Comment Text") return "<p>Checked</p>";
    return "";
  });
  await writeFile(directory, "missing-columns.xls", await writeXlsxFile([missingHeaders, missingRow]).toBuffer());

  await writeFile(directory, "unreadable-xlsx.xls", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
  await writeFile(directory, "not-xlsx.csv", new TextEncoder().encode("Section Name,Item Name\nRoof,Shingles\n"));
  await writeFile(directory, "not-xlsx.pdf", new TextEncoder().encode("%PDF-1.7\n"));
  await writeFile(directory, "too-large.xls", Buffer.alloc(FIVE_MB));

  const warnings = [
    rowFor({
      "comment text": `<p style="background: url(https://evil.test/x)">t</p>`,
    }),
    rowFor({ "item name": "Flashing", "comment name": "Drip edge" }),
    rowFor({ "comment name": "" }),
  ];
  await writeFile(directory, "warnings.xls", await writeXlsxFile([HEADERS, ...warnings]).toBuffer());
}

function rowFor(overrides: Record<string, string>): string[] {
  return HEADERS.map((header) => {
    const key = header.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] ?? "";
    if (key === "section name") return "Roof";
    if (key === "item name") return "Covering";
    if (key === "comment name") return "Shingles";
    if (key === "comment text") return "<p>Checked</p>";
    if (key === "comment type") return "info";
    if (key === "answer type") return "boolean";
    return "";
  });
}

async function writeFile(directory: string, name: string, bytes: Uint8Array): Promise<void> {
  await fs.promises.writeFile(path.join(directory, name), bytes);
}

async function main() {
  const directory = path.resolve(SAMPLES_DIR);
  await writeSampleFiles(directory);
  console.log(directory);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
