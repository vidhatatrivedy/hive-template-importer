import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import writeXlsxFile from "write-excel-file/node";
import { EXPECTED_HEADERS } from "../src/core/import/parse-spectora-export";

/** Gitignored folder `npm run samples` fills for the hand checklist and the demo. */
const SAMPLES_DIR = "samples";

const COMMENT_TYPE = "Comment Type (info, limit, defect)";
const FIVE_MB = 5 * 1024 * 1024;

/** Filled cells for a normal comment row. Keys are headers with the parenthetical hint removed. */
const DEFAULT_CELLS: Record<string, string> = {
  "section name": "Roof",
  "item name": "Covering",
  "comment name": "Shingles",
  "comment text": "<p>Checked</p>",
  "comment type": "info",
  "answer type": "boolean",
};

/** Values on the row that omits Item Name and Comment Type. Answer type stays blank. */
const MISSING_COLUMN_CELLS: Record<string, string> = {
  "Section Name": "Roof",
  "Comment Name": "Shingles",
  "Comment Text": "<p>Checked</p>",
};

/**
 * Writes the rejection and edge-case files the checklist uploads.
 * The synthetic-workbook helpers in the parser tests are not exported, so these
 * files are built here with write-excel-file.
 */
export async function writeSampleFiles(directory: string): Promise<void> {
  fs.mkdirSync(directory, { recursive: true });

  await writeFile(directory, "no-data-rows.xls", await writeXlsxFile([[...EXPECTED_HEADERS]]).toBuffer());

  const omitted = new Set<string>(["Item Name", COMMENT_TYPE]);
  const missingHeaders = EXPECTED_HEADERS.filter((header) => !omitted.has(header));
  const missingRow = missingHeaders.map((header) => MISSING_COLUMN_CELLS[header] ?? "");
  await writeFile(directory, "missing-columns.xls", await writeXlsxFile([missingHeaders, missingRow]).toBuffer());

  await writeFile(directory, "unreadable-xlsx.xls", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
  await writeFile(directory, "not-xlsx.csv", new TextEncoder().encode("Section Name,Item Name\nRoof,Shingles\n"));
  await writeFile(directory, "not-xlsx.pdf", new TextEncoder().encode("%PDF-1.7\n"));
  await writeFile(directory, "too-large.xls", Buffer.alloc(FIVE_MB));

  const unsafeStyle = rowFor({
    "comment text": `<p style="background: url(https://evil.test/x)">t</p>`,
  });
  const splitItem = rowFor({ "item name": "Flashing", "comment name": "Drip edge" });
  const blankCommentName = rowFor({ "comment name": "" });
  await writeFile(
    directory,
    "warnings.xls",
    await writeXlsxFile([[...EXPECTED_HEADERS], unsafeStyle, splitItem, blankCommentName]).toBuffer(),
  );
}

function headerKey(header: string): string {
  return header.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
}

function rowFor(overrides: Record<string, string>): string[] {
  return EXPECTED_HEADERS.map((header) => {
    const key = headerKey(header);
    if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key] ?? "";
    return DEFAULT_CELLS[key] ?? "";
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
