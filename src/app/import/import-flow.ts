import type { ImportActionError } from "@/core/import/import-errors";
import { MAX_UPLOAD_BYTES } from "@/core/import/rejections";
import type { ImportReview } from "@/app/import/import-review";

export type PreviewResult = { ok: true; review: ImportReview } | { ok: false; error: ImportActionError };

/** Commit returns only on failure; on success it redirects to the Template. */
export type CommitResult = { ok: false; error: ImportActionError };

/** The `File` lives in every step that may still send it. */
export type ImportFlow =
  | { step: "idle" }
  | { step: "reading"; file: File }
  | { step: "reviewing"; file: File; review: ImportReview; name: string }
  | { step: "committing"; file: File; review: ImportReview; name: string }
  | { step: "rejected"; filename: string; error: ImportActionError; file: File | null }; // file kept for Review again

export type ImportFlowEvent =
  | { type: "file-chosen"; file: File }
  | { type: "preview-returned"; file: File; result: PreviewResult }
  | { type: "name-edited"; name: string }
  | { type: "import" }
  | { type: "commit-failed"; file: File; error: ImportActionError }
  | { type: "cancel" }
  | { type: "choose-another" }
  | { type: "review-again" };

export const initialImportFlow: ImportFlow = { step: "idle" };

/**
 * The import page's state machine. Entering `reading` is the cue to send the preview,
 * and entering `committing` the cue to send the commit; no other step sends anything.
 * A result for a file that's no longer current returns the state unchanged.
 */
export function importFlow(state: ImportFlow, event: ImportFlowEvent): ImportFlow {
  switch (event.type) {
    case "file-chosen": {
      if (state.step === "committing") return state;
      const { file } = event;
      if (file.size > MAX_UPLOAD_BYTES) {
        const error = { kind: "too-large", byteSize: file.size, limit: MAX_UPLOAD_BYTES } as const;
        return { step: "rejected", filename: file.name, error, file: null };
      }
      return { step: "reading", file };
    }
    case "preview-returned": {
      if (state.step !== "reading" || state.file !== event.file) return state;
      const { result } = event;
      if (!result.ok) return { step: "rejected", filename: state.file.name, error: result.error, file: null };
      return { step: "reviewing", file: state.file, review: result.review, name: result.review.suggestedName };
    }
    case "name-edited":
      return state.step === "reviewing" ? { ...state, name: event.name } : state;
    case "import":
      if (state.step !== "reviewing" || state.name.trim() === "") return state;
      return { ...state, step: "committing" };
    case "commit-failed": {
      if (state.step !== "committing" || state.file !== event.file) return state;
      const file = event.error.kind === "hash-mismatch" ? state.file : null;
      return { step: "rejected", filename: state.file.name, error: event.error, file };
    }
    case "cancel":
      return state.step === "reviewing" || state.step === "reading" ? initialImportFlow : state;
    case "choose-another":
      return state.step === "rejected" ? initialImportFlow : state;
    case "review-again":
      if (state.step !== "rejected" || state.error.kind !== "hash-mismatch" || !state.file) return state;
      return { step: "reading", file: state.file };
    default: {
      const unreachable: never = event;
      throw new Error(`Unknown import flow event: ${String(unreachable)}`);
    }
  }
}
