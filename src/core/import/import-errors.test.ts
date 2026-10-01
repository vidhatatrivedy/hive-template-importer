import { describe, expect, it } from "vitest";
import { importErrorKinds, importErrorMessage, type ImportActionError, type ImportErrorKind } from "@/core/import/import-errors";
import { MAX_UPLOAD_BYTES } from "@/core/import/rejections";

const samples: Record<ImportErrorKind, ImportActionError> = {
  "too-large": { kind: "too-large", byteSize: 5 * 1024 * 1024, limit: MAX_UPLOAD_BYTES },
  "not-xlsx": { kind: "not-xlsx" },
  "unreadable-xlsx": { kind: "unreadable-xlsx" },
  "no-data-rows": { kind: "no-data-rows" },
  "missing-columns": { kind: "missing-columns", missing: ["Item Name"] },
  "plain-text-export": { kind: "plain-text-export" },
  "hash-mismatch": { kind: "hash-mismatch" },
  "name-blank": { kind: "name-blank" },
};

describe("importErrorMessage", () => {
  it("renders a non-empty message for every ImportActionError kind", () => {
    expect(importErrorKinds).toHaveLength(8);
    for (const kind of importErrorKinds) {
      expect(importErrorMessage(samples[kind]).trim().length, kind).toBeGreaterThan(0);
    }
  });

  it("words the two import errors as the spec does", () => {
    expect(importErrorMessage({ kind: "hash-mismatch" })).toBe(
      "This file changed after you reviewed it. Review it again before importing.",
    );
    expect(importErrorMessage({ kind: "name-blank" })).toBe("Give the Template a name.");
  });

  it("shows a too-large file's size and the limit in MB with one decimal", () => {
    expect(importErrorMessage(samples["too-large"])).toBe("This file is 5.0 MB, which is over the 4.0 MB limit.");
  });
});
