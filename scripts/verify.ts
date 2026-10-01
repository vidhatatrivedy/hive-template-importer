import fs from "node:fs";
import path from "node:path";
import { parseSpectoraExport } from "../src/core/import/parse-spectora-export";

const FIXTURE_DIR = path.resolve("fixtures/spectora");

async function main() {
  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".xls"))
    .sort();

  const rows = [];
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(FIXTURE_DIR, file));
    const result = await parseSpectoraExport(bytes, file);
    const comments = result.draft.tree.sections.reduce(
      (sum, section) => sum + section.items.reduce((inner, item) => inner + item.comments.length, 0),
      0,
    );
    const items = result.draft.tree.sections.reduce((sum, section) => sum + section.items.length, 0);
    rows.push({
      file,
      rowsRead: result.draft.run.rowsRead,
      comments,
      sections: result.draft.tree.sections.length,
      items,
    });
  }

  const fileWidth = Math.max("file".length, ...rows.map((row) => row.file.length));
  const line = (file: string, rowsRead: string, comments: string, sections: string, items: string) =>
    `${file.padEnd(fileWidth)}  ${rowsRead.padStart(8)}  ${comments.padStart(8)}  ${sections.padStart(8)}  ${items.padStart(5)}`;

  console.log(line("file", "rows", "comments", "sections", "items"));
  for (const row of rows) {
    console.log(line(row.file, String(row.rowsRead), String(row.comments), String(row.sections), String(row.items)));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
