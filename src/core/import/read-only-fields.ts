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

type ColumnIndexes = {
  location: number;
  estimateMin: number;
  estimateMax: number;
  lastModified: number;
  photos: { url: number; caption: number }[];
};

/**
 * Read-only Comment fields keyed by Source row.
 * Headers match by trim and case. These names have no trailing parenthetical, so that is the parser's rule for them.
 * The parser's matcher is not exported.
 */
export function readOnlyFields(evidence: ImportEvidence): Record<number, ReadOnlyFields> {
  const columns = columnIndexes(evidence.run.headers);
  const byRow: Record<number, ReadOnlyFields> = {};
  for (const row of evidence.sourceRows) {
    const fields = fieldsOnRow(row.cells, columns);
    if (fields) byRow[row.rowNumber] = fields;
  }
  return byRow;
}

function columnIndexes(headers: readonly string[]): ColumnIndexes {
  return {
    location: findHeader(headers, "Default Location"),
    estimateMin: findHeader(headers, "Default Estimate Min"),
    estimateMax: findHeader(headers, "Default Estimate Max"),
    lastModified: findHeader(headers, "Last Modified"),
    photos: Array.from({ length: PHOTO_COUNT }, (_, index) => {
      const number = index + 1;
      return {
        url: findHeader(headers, `Default Photo ${number}`),
        caption: findHeader(headers, `Default Photo ${number} Caption`),
      };
    }),
  };
}

function fieldsOnRow(cells: readonly Cell[], columns: ColumnIndexes): ReadOnlyFields | null {
  const fields: ReadOnlyFields = {};
  const defaultLocation = cellText(cellAt(cells, columns.location));
  const estimateMin = cellText(cellAt(cells, columns.estimateMin));
  const estimateMax = cellText(cellAt(cells, columns.estimateMax));
  const lastModified = cellText(cellAt(cells, columns.lastModified));
  if (defaultLocation !== null) fields.defaultLocation = defaultLocation;
  if (estimateMin !== null) fields.estimateMin = estimateMin;
  if (estimateMax !== null) fields.estimateMax = estimateMax;
  if (lastModified !== null) fields.lastModified = lastModified;

  const photos = photosOnRow(cells, columns.photos);
  if (photos.length > 0) fields.photos = photos;
  if (!hasContent(fields)) return null;
  return fields;
}

function photosOnRow(cells: readonly Cell[], columns: ColumnIndexes["photos"]): ReadOnlyPhoto[] {
  const photos: ReadOnlyPhoto[] = [];
  for (const column of columns) {
    const url = cellText(cellAt(cells, column.url));
    const caption = cellText(cellAt(cells, column.caption));
    if (url === null && caption === null) continue;
    photos.push({ url, caption });
  }
  return photos;
}

function hasContent(fields: ReadOnlyFields): boolean {
  return (
    fields.defaultLocation !== undefined ||
    fields.estimateMin !== undefined ||
    fields.estimateMax !== undefined ||
    fields.lastModified !== undefined ||
    fields.photos !== undefined
  );
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
