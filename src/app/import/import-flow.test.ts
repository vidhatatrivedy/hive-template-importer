import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/core/import/rejections";
import { importFlow, initialImportFlow, type ImportFlow } from "@/app/import/import-flow";
import type { ImportReview } from "@/app/import/import-review";

const review: ImportReview = {
  filename: "Radon.xls",
  byteSize: 1000,
  sha256: "abc",
  suggestedName: "Radon",
  counts: { rowsRead: 10, blankRows: 0, sections: 2, items: 3, comments: 10 },
  issueCounts: { warning: 0, notice: 2 },
  previousImport: null,
};

function fileOf(name: string, byteSize = 1000): File {
  return new File([new Uint8Array(byteSize)], name);
}

function reviewing(file: File, name = "Radon"): ImportFlow {
  return { step: "reviewing", file, review, name };
}

describe("importFlow", () => {
  it("refuses a 5 MB file straight away, without a reading step that would send it", () => {
    const file = fileOf("big.xls", 5 * 1024 * 1024);
    expect(importFlow(initialImportFlow, { type: "file-chosen", file })).toEqual({
      step: "rejected",
      filename: "big.xls",
      error: { kind: "too-large", byteSize: 5 * 1024 * 1024, limit: MAX_UPLOAD_BYTES },
      file: null,
    });
  });

  it("reads a file at the limit", () => {
    const file = fileOf("edge.xls", MAX_UPLOAD_BYTES);
    expect(importFlow(initialImportFlow, { type: "file-chosen", file })).toEqual({ step: "reading", file });
  });

  it("reviews a previewed file under its suggested name", () => {
    const file = fileOf("Radon.xls");
    const reading = importFlow(initialImportFlow, { type: "file-chosen", file });
    expect(importFlow(reading, { type: "preview-returned", file, result: { ok: true, review } })).toEqual(
      reviewing(file),
    );
  });

  it("shows a preview's rejection", () => {
    const file = fileOf("plain.xls");
    const next = importFlow(
      { step: "reading", file },
      { type: "preview-returned", file, result: { ok: false, error: { kind: "plain-text-export" } } },
    );
    expect(next).toEqual({ step: "rejected", filename: "plain.xls", error: { kind: "plain-text-export" }, file: null });
  });

  it("drops a preview result for a file that's been replaced", () => {
    const first = fileOf("first.xls");
    const second = fileOf("second.xls");
    const reading = importFlow({ step: "reading", file: first }, { type: "file-chosen", file: second });
    expect(reading).toEqual({ step: "reading", file: second });
    expect(importFlow(reading, { type: "preview-returned", file: first, result: { ok: true, review } })).toBe(reading);
  });

  it("drops a preview result after Cancel", () => {
    const file = fileOf("Radon.xls");
    const idle = importFlow({ step: "reading", file }, { type: "cancel" });
    expect(idle).toEqual({ step: "idle" });
    expect(importFlow(idle, { type: "preview-returned", file, result: { ok: true, review } })).toBe(idle);
  });

  it("edits the name while reviewing", () => {
    const file = fileOf("Radon.xls");
    expect(importFlow(reviewing(file), { type: "name-edited", name: "  Radon v2 " })).toEqual(
      reviewing(file, "  Radon v2 "),
    );
  });

  it("imports with a non-blank name and refuses a blank one", () => {
    const file = fileOf("Radon.xls");
    expect(importFlow(reviewing(file, " Radon "), { type: "import" })).toEqual({
      step: "committing",
      file,
      review,
      name: " Radon ",
    });
    const blank = reviewing(file, "   ");
    expect(importFlow(blank, { type: "import" })).toBe(blank);
  });

  it("ignores a new file while committing", () => {
    const file = fileOf("Radon.xls");
    const committing: ImportFlow = { step: "committing", file, review, name: "Radon" };
    expect(importFlow(committing, { type: "file-chosen", file: fileOf("other.xls") })).toBe(committing);
    expect(importFlow(committing, { type: "cancel" })).toBe(committing);
  });

  it("keeps the file on hash-mismatch so Review again reads it again", () => {
    const file = fileOf("Radon.xls");
    const rejected = importFlow(
      { step: "committing", file, review, name: "Radon" },
      { type: "commit-failed", file, error: { kind: "hash-mismatch" } },
    );
    expect(rejected).toEqual({ step: "rejected", filename: "Radon.xls", error: { kind: "hash-mismatch" }, file });
    expect(importFlow(rejected, { type: "review-again" })).toEqual({ step: "reading", file });
  });

  it("offers Review again only for hash-mismatch", () => {
    const file = fileOf("Radon.xls");
    const rejected = importFlow(
      { step: "committing", file, review, name: "Radon" },
      { type: "commit-failed", file, error: { kind: "name-blank" } },
    );
    expect(rejected).toEqual({ step: "rejected", filename: "Radon.xls", error: { kind: "name-blank" }, file: null });
    expect(importFlow(rejected, { type: "review-again" })).toBe(rejected);
  });

  it("returns to idle on Cancel and on Choose another file", () => {
    const file = fileOf("Radon.xls");
    expect(importFlow(reviewing(file), { type: "cancel" })).toEqual({ step: "idle" });
    const rejected: ImportFlow = { step: "rejected", filename: "x.pdf", error: { kind: "not-xlsx" }, file: null };
    expect(importFlow(rejected, { type: "choose-another" })).toEqual({ step: "idle" });
  });

  it("starts over when a file is dropped on the rejection screen", () => {
    const file = fileOf("Radon.xls");
    const rejected: ImportFlow = { step: "rejected", filename: "x.pdf", error: { kind: "not-xlsx" }, file: null };
    expect(importFlow(rejected, { type: "file-chosen", file })).toEqual({ step: "reading", file });
  });
});
