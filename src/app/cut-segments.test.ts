import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import type { ImportDraft } from "@/core/import/schemas";
import { applyCuts, type Cut } from "@/core/sanitise";
import { htmlFixtureFiles } from "@/core/test/fixture-comment-texts";
import { cutSegments, type CutSpan, type Segment } from "@/app/cut-segments";

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/spectora");

function span(start: number, end: number, kind: CutSpan["kind"], removedText: string, replacement?: string): CutSpan {
  return { start, end, kind, removedText, replacement };
}

function textOf(segments: readonly Segment[], kinds: ReadonlySet<Segment["kind"]>): string {
  return segments
    .filter((segment) => kinds.has(segment.kind))
    .map((segment) => segment.text)
    .join("");
}

describe("cutSegments", () => {
  it("keeps the whole Comment when nothing was cut", () => {
    expect(cutSegments("No formatting here.", [])).toEqual([{ kind: "kept", text: "No formatting here." }]);
    expect(cutSegments("", [])).toEqual([{ kind: "kept", text: "" }]);
  });

  it("strikes a cut at the start and keeps the rest", () => {
    const raw = "<script>alert(1)</script>Visible";
    const segments = cutSegments(raw, [span(0, 25, "tag-removed", raw.slice(0, 25))]);

    expect(segments).toEqual([
      { kind: "removed", text: "<script>alert(1)</script>", cutKind: "tag-removed" },
      { kind: "kept", text: "Visible" },
    ]);
  });

  it("strikes a cut at the end and keeps the start", () => {
    const raw = "Visible<br>";
    const segments = cutSegments(raw, [span(7, 11, "tag-unwrapped", "<br>")]);

    expect(segments).toEqual([
      { kind: "kept", text: "Visible" },
      { kind: "removed", text: "<br>", cutKind: "tag-unwrapped" },
    ]);
  });

  it("shows a replacement immediately after the span it replaced", () => {
    const raw = '<iframe src="http://evil.test"></iframe> after';
    const replacement = '<a href="http://evil.test">http://evil.test</a>';
    const segments = cutSegments(raw, [span(0, 40, "iframe-to-link", raw.slice(0, 40), replacement)]);

    expect(segments).toEqual([
      { kind: "removed", text: '<iframe src="http://evil.test"></iframe>', cutKind: "iframe-to-link" },
      { kind: "inserted", text: replacement, cutKind: "iframe-to-link" },
      { kind: "kept", text: " after" },
    ]);
  });

  it("places adjacent cuts next to each other, with no empty gap", () => {
    const raw = "abcdef";
    const segments = cutSegments(raw, [
      span(2, 4, "attribute-removed", "cd"),
      span(0, 2, "tag-removed", "ab"),
    ]);

    expect(segments).toEqual([
      { kind: "removed", text: "ab", cutKind: "tag-removed" },
      { kind: "removed", text: "cd", cutKind: "attribute-removed" },
      { kind: "kept", text: "ef" },
    ]);
  });

  it("rebuilds every fixture Comment: kept and removed are the raw text, kept and inserted are the stored text", async () => {
    let comments = 0;
    for (const file of htmlFixtureFiles()) {
      const draft = await draftOf(file);
      const column = draft.run.headers.findIndex((header) => header.trim().toLowerCase() === "comment text");
      expect(column, file).toBeGreaterThanOrEqual(0);

      for (const section of draft.tree.sections) {
        for (const item of section.items) {
          for (const comment of item.comments) {
            comments += 1;
            const raw = rawCommentText(draft, comment.sourceRow, column);
            const cuts = cutsOnRow(draft, comment.sourceRow);
            const segments = cutSegments(raw, cuts);
            const label = `${file} row ${comment.sourceRow ?? "none"}`;

            expect(textOf(segments, new Set(["kept", "removed"])), label).toBe(raw);
            expect(textOf(segments, new Set(["kept", "inserted"])), label).toBe(applyCuts(raw, replayCuts(cuts)));
          }
        }
      }
    }
    expect(comments).toBeGreaterThan(2000);
  });
});

function rawCommentText(draft: ImportDraft, sourceRow: number | null, column: number): string {
  if (sourceRow === null) return "";
  const row = draft.sourceRows.find((candidate) => candidate.rowNumber === sourceRow);
  const value = row?.cells[column];
  return typeof value === "string" ? value : "";
}

function cutsOnRow(draft: ImportDraft, sourceRow: number | null): CutSpan[] {
  if (sourceRow === null) return [];
  return draft.issues
    .filter((issue) => issue.sourceRow === sourceRow)
    .flatMap((issue) => issue.cuts);
}

/** Sorted, as applyCuts requires. The view's cuts arrive in issue order, which is not start order. */
function replayCuts(cuts: readonly CutSpan[]): Cut[] {
  return [...cuts]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((cut) => ({
      start: cut.start,
      end: cut.end,
      kind: cut.kind,
      removedText: cut.removedText,
      replacement: cut.replacement ?? undefined,
      context: { tag: "" },
    }));
}

async function draftOf(file: string): Promise<ImportDraft> {
  const result = await parseSpectoraExport(fs.readFileSync(path.join(FIXTURE_DIR, file)), file);
  if (!result.ok) throw new Error(`${file} was rejected: ${result.rejection.kind}`);
  return result.draft;
}
