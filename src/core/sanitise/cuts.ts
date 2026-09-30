export type CutKind =
  | "editor-leftover"
  | "attribute-removed"
  | "css-property-removed"
  | "style-unparseable"
  | "tag-removed"
  | "tag-unwrapped"
  | "link-scheme-removed"
  | "iframe-to-link"
  | "youtube-wrapper-emptied"
  | "markup-rebuilt";

export const cutKinds: CutKind[] = [
  "editor-leftover",
  "attribute-removed",
  "css-property-removed",
  "style-unparseable",
  "tag-removed",
  "tag-unwrapped",
  "link-scheme-removed",
  "iframe-to-link",
  "youtube-wrapper-emptied",
  "markup-rebuilt",
];

/** One change the sanitiser made: a span of the input string, end exclusive, in UTF-16 offsets. */
export type Cut = {
  start: number;
  end: number;
  kind: CutKind;
  /** Exactly `input.slice(start, end)`. */
  removedText: string;
  replacement?: string;
  context: { tag: string; attribute?: string; property?: string };
};

/**
 * Replays a cut log onto its source string. Cuts must be sorted by `start` and must not
 * overlap. Reconciliation uses this, so it and the sanitiser can't disagree about a cut.
 */
export function applyCuts(input: string, cuts: readonly Cut[]): string {
  let output = "";
  let position = 0;
  for (const cut of cuts) {
    if (cut.start < position || cut.end < cut.start || cut.end > input.length) {
      throw new RangeError(`Cut ${cut.start}–${cut.end} is out of order, overlapping or out of range`);
    }
    output += input.slice(position, cut.start) + (cut.replacement ?? "");
    position = cut.end;
  }
  return output + input.slice(position);
}
