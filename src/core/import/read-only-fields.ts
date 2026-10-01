import type { Cell } from "@/core/import/reconcile";
import type { ImportEvidence } from "@/core/import/schemas";

export type ReadOnlyPhoto = {
  url: string | null;
  caption: string | null;
};

/** Values the editor shows and cannot edit. Absent cells are omitted. */
export type ReadOnlyFields = {
  defaultLocation?: string;
  estimateMin?: string;
  estimateMax?: string;
  photos?: ReadOnlyPhoto[];
  lastModified?: string;
};

const PHOTO_COUNT = 10;

/**
 * Read-only Comment fields keyed by Source row.
 * Columns are matched by trimmed, case-insensitive header name. The parser's matcher is not exported.
 */
export function readOnlyFields(evidence: ImportEvidence): Record<number, ReadOnlyFields> {
  const headers = evidence.run.headers;
  const location = findHeader(headers, "Default Location");
  const estimateMin = findHeader(headers, "Default Estimate Min");
  const estimateMax = findHeader(headers, "Default Estimate Max");
  const lastModified = findHeader(headers, "Last Modified");
  const photoColumns = Array.from({ length: PHOTO_COUNT }, (_, index) => {
    const number = index + 1;
    return {
      url: findHeader(headers, `Default Photo ${number}`),
      caption: findHeader(headers, `Default Photo ${number} Caption`),
    };
  });

  const byRow: Record<number, ReadOnlyFields> = {};
  for (const row of evidence.sourceRows) {
    const fields: ReadOnlyFields = {};
    const defaultLocation = cellText(cellAt(row.cells, location));
    const min = cellText(cellAt(row.cells, estimateMin));
    const max = cellText(cellAt(row.cells, estimateMax));
    const modified = cellText(cellAt(row.cells, lastModified));
    if (defaultLocation !== null) fields.defaultLocation = defaultLocation;
    if (min !== null) fields.estimateMin = min;
    if (max !== null) fields.estimateMax = max;
    if (modified !== null) fields.lastModified = modified;

    const photos: ReadOnlyPhoto[] = [];
    for (const column of photoColumns) {
      const url = cellText(cellAt(row.cells, column.url));
      const caption = cellText(cellAt(row.cells, column.caption));
      if (url === null && caption === null) continue;
      photos.push({ url, caption });
    }
    if (photos.length > 0) fields.photos = photos;

    if (
      fields.defaultLocation !== undefined ||
      fields.estimateMin !== undefined ||
      fields.estimateMax !== undefined ||
      fields.lastModified !== undefined ||
      fields.photos !== undefined
    ) {
      byRow[row.rowNumber] = fields;
    }
  }
  return byRow;
}

function findHeader(headers: readonly string[], expected: string): number {
  const name = expected.trim().toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === name);
}

function cellAt(cells: readonly Cell[], index: number): Cell | undefined {
  if (index < 0) return undefined;
  return cells[index];
}

/** Raw text. A blank or whitespace-only cell is omitted; a leading space on real text stays. */
function cellText(value: Cell | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    return value;
  }
  return String(value);
}
