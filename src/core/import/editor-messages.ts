// Safe to import in the browser: messages only, never the parser or the sanitiser.

/** Every expected failure of Save. `stale-base`, `template-not-found` and `foreign-source-row` match `DbRefusal`. */
export const saveErrorKinds = [
  "stale-base",
  "template-not-found",
  "foreign-source-row",
  "names-blank",
  "save-failed",
] as const;

export type SaveErrorKind = (typeof saveErrorKinds)[number];

export type SaveError =
  | { kind: "stale-base"; latestNumber: number }
  | { kind: "template-not-found" }
  | { kind: "foreign-source-row"; rowNumbers: number[] }
  | { kind: "names-blank"; count: number }
  | { kind: "save-failed" };

/** Every expected failure of Restore. */
export const restoreErrorKinds = ["stale-base", "template-not-found", "restore-failed"] as const;

export type RestoreErrorKind = (typeof restoreErrorKinds)[number];

export type RestoreError =
  | { kind: "stale-base"; latestNumber: number }
  | { kind: "template-not-found" }
  | { kind: "restore-failed" };

/** The header message for a refused Save. */
export function saveErrorMessage(error: SaveError): string {
  switch (error.kind) {
    case "stale-base":
      return `Version ${error.latestNumber} was saved elsewhere while you were editing. Your changes weren't saved.`;
    case "template-not-found":
      return "This Template doesn't exist any more. It may have been deleted. Your changes weren't saved.";
    case "foreign-source-row":
      return `Rows ${listNumbers(error.rowNumbers)} aren't Source rows of this Template's import, so nothing was saved. This is a bug.`;
    case "names-blank":
      return error.count === 1
        ? "1 name is empty. Name it, then save."
        : `${error.count} names are empty. Name them, then save.`;
    case "save-failed":
      return "Save didn't go through. Your changes are still here. Try again.";
    default: {
      const unreachable: never = error;
      throw new Error(`Unknown Save error: ${String(unreachable)}`);
    }
  }
}

/** The banner message for a refused Restore. Wording differs from Save for the same kind. */
export function restoreErrorMessage(error: RestoreError): string {
  switch (error.kind) {
    case "stale-base":
      return `Version ${error.latestNumber} was saved while you were looking at this one. Nothing was restored.`;
    case "template-not-found":
      return "This Template doesn't exist any more. Nothing was restored.";
    case "restore-failed":
      return "Restore didn't go through. Try again.";
    default: {
      const unreachable: never = error;
      throw new Error(`Unknown Restore error: ${String(unreachable)}`);
    }
  }
}

function listNumbers(numbers: readonly number[]): string {
  if (numbers.length <= 1) return numbers[0] !== undefined ? String(numbers[0]) : "";
  if (numbers.length === 2) return `${numbers[0]} and ${numbers[1]}`;
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}
