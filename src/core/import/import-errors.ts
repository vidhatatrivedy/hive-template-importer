// Safe to import in the browser: it pulls in only the rejection messages, never the parser.
import { rejectionKinds, rejectionMessage, type Rejection } from "@/core/import/rejections";

/** Every expected failure of the preview and commit actions. */
export type ImportActionError =
  | Rejection
  | { kind: "hash-mismatch" } // commit's file isn't the reviewed one
  | { kind: "name-blank" }; // the trimmed name is blank

export const importErrorKinds = [...rejectionKinds, "hash-mismatch", "name-blank"] as const;

export type ImportErrorKind = (typeof importErrorKinds)[number];

/** One lookup for any `ImportActionError`. */
export function importErrorMessage(error: ImportActionError): string {
  switch (error.kind) {
    case "hash-mismatch":
      return "This file changed after you reviewed it. Review it again before importing.";
    case "name-blank":
      return "Give the Template a name.";
    default:
      return rejectionMessage(error);
  }
}
