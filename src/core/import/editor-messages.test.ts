import { describe, expect, it } from "vitest";
import {
  restoreErrorKinds,
  restoreErrorMessage,
  saveErrorKinds,
  saveErrorMessage,
  type RestoreError,
  type RestoreErrorKind,
  type SaveError,
  type SaveErrorKind,
} from "@/core/import/editor-messages";

const saveSamples: Record<SaveErrorKind, SaveError> = {
  "stale-base": { kind: "stale-base", latestNumber: 4 },
  "template-not-found": { kind: "template-not-found" },
  "foreign-source-row": { kind: "foreign-source-row", rowNumbers: [4, 9] },
  "names-blank": { kind: "names-blank", count: 2 },
  "save-failed": { kind: "save-failed" },
};

const restoreSamples: Record<RestoreErrorKind, RestoreError> = {
  "stale-base": { kind: "stale-base", latestNumber: 4 },
  "template-not-found": { kind: "template-not-found" },
  "restore-failed": { kind: "restore-failed" },
};

describe("editor messages", () => {
  it("renders a non-empty message for every Save and Restore error kind", () => {
    expect(saveErrorKinds).toHaveLength(5);
    expect(restoreErrorKinds).toHaveLength(3);
    for (const kind of saveErrorKinds) {
      expect(saveErrorMessage(saveSamples[kind]).trim().length, kind).toBeGreaterThan(0);
    }
    for (const kind of restoreErrorKinds) {
      expect(restoreErrorMessage(restoreSamples[kind]).trim().length, kind).toBeGreaterThan(0);
    }
  });

  it("words Save errors as the spec does", () => {
    expect(saveErrorMessage({ kind: "stale-base", latestNumber: 4 })).toBe(
      "Version 4 was saved elsewhere while you were editing. Your changes weren't saved.",
    );
    expect(saveErrorMessage({ kind: "template-not-found" })).toBe(
      "This Template doesn't exist any more. It may have been deleted. Your changes weren't saved.",
    );
    expect(saveErrorMessage({ kind: "foreign-source-row", rowNumbers: [4, 9] })).toBe(
      "Rows 4 and 9 aren't Source rows of this Template's import, so nothing was saved. This is a bug.",
    );
    expect(saveErrorMessage({ kind: "foreign-source-row", rowNumbers: [4, 9, 12] })).toBe(
      "Rows 4, 9 and 12 aren't Source rows of this Template's import, so nothing was saved. This is a bug.",
    );
    expect(saveErrorMessage({ kind: "foreign-source-row", rowNumbers: [4] })).toBe(
      "Rows 4 aren't Source rows of this Template's import, so nothing was saved. This is a bug.",
    );
    expect(saveErrorMessage({ kind: "names-blank", count: 2 })).toBe("2 names are empty. Name them, then save.");
    expect(saveErrorMessage({ kind: "names-blank", count: 1 })).toBe("1 name is empty. Name it, then save.");
    expect(saveErrorMessage({ kind: "save-failed" })).toBe(
      "Save didn't go through. Your changes are still here. Try again.",
    );
  });

  it("words Restore errors as the spec does", () => {
    expect(restoreErrorMessage({ kind: "stale-base", latestNumber: 4 })).toBe(
      "Version 4 was saved while you were looking at this one. Nothing was restored.",
    );
    expect(restoreErrorMessage({ kind: "template-not-found" })).toBe(
      "This Template doesn't exist any more. Nothing was restored.",
    );
    expect(restoreErrorMessage({ kind: "restore-failed" })).toBe("Restore didn't go through. Try again.");
  });
});
