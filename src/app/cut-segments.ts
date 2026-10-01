import type { CutKind } from "@/core/sanitise/cuts";

/** One span of a Comment's raw text, as the Source row view shows it. */
export type Segment =
  | { kind: "kept"; text: string }
  | { kind: "removed"; text: string; cutKind: CutKind }
  | { kind: "inserted"; text: string; cutKind: CutKind };

/** A sanitiser cut, or the same span as stored on an Import issue. */
export type CutSpan = {
  start: number;
  end: number;
  kind: CutKind;
  removedText: string;
  replacement?: string | null;
};

/**
 * Splits raw Comment Text into the spans the Source row view draws.
 * Cuts may arrive in issue order; they are sorted by start and must not overlap.
 * A non-empty `replacement` becomes an inserted span immediately after the removed one.
 */
export function cutSegments(raw: string, cuts: readonly CutSpan[]): Segment[] {
  const ordered = [...cuts].sort((left, right) => left.start - right.start || left.end - right.end);
  const segments: Segment[] = [];
  let position = 0;

  for (const cut of ordered) {
    if (cut.start < position || cut.end < cut.start || cut.end > raw.length) {
      throw new RangeError(`Cut ${cut.start}–${cut.end} is out of order, overlapping or out of range`);
    }
    if (cut.start > position) segments.push({ kind: "kept", text: raw.slice(position, cut.start) });
    segments.push({ kind: "removed", text: raw.slice(cut.start, cut.end), cutKind: cut.kind });
    if (cut.replacement) segments.push({ kind: "inserted", text: cut.replacement, cutKind: cut.kind });
    position = cut.end;
  }

  if (ordered.length === 0 || position < raw.length) {
    segments.push({ kind: "kept", text: raw.slice(position) });
  }
  return segments;
}
