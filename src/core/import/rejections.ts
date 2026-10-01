/** 4 MiB. The browser upload check and the parser both use this limit. */
export const MAX_UPLOAD_BYTES = 4_194_304;

export const rejectionKinds = [
  "too-large",
  "not-xlsx",
  "unreadable-xlsx",
  "no-data-rows",
  "missing-columns",
  "plain-text-export",
] as const;

export type RejectionKind = (typeof rejectionKinds)[number];

export type Rejection =
  | { kind: "too-large"; byteSize: number; limit: number }
  | { kind: "not-xlsx" }
  | { kind: "unreadable-xlsx" }
  | { kind: "no-data-rows" }
  | { kind: "missing-columns"; missing: string[] }
  | { kind: "plain-text-export" };

const EXPORT_HTML_TEXT = "In Spectora: Template → ⋮ → Export to spreadsheet → Export HTML Text.";

/** The message for a rejection. Wording for the six kinds comes from the Import flow decision. */
export function rejectionMessage(rejection: Rejection): string {
  switch (rejection.kind) {
    case "too-large":
      return `This file is ${megabytes(rejection.byteSize)}, which is over the ${megabytes(rejection.limit)} limit.`;
    case "not-xlsx":
      return `This isn't a Spectora spreadsheet export. ${EXPORT_HTML_TEXT}`;
    case "unreadable-xlsx":
      return `This spreadsheet couldn't be read. ${EXPORT_HTML_TEXT}`;
    case "no-data-rows":
      return "This export has no comments.";
    case "missing-columns":
      return `This export is missing ${joinNames(rejection.missing)}.`;
    case "plain-text-export":
      return "This is Spectora's plain-text export. It has lost all formatting and link URLs. Re-export with … Export HTML Text.";
    default: {
      const unreachable: never = rejection;
      throw new Error(`Unknown rejection kind: ${String(unreachable)}`);
    }
  }
}

/** MB as the limit is defined: 1 MB = 1024 × 1024 bytes, so the limit reads 4.0 MB. */
function megabytes(byteSize: number): string {
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
