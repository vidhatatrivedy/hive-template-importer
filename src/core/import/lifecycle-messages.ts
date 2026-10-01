// Safe to import in the browser: messages only, never the parser or the sanitiser.
import { importErrorMessage } from "@/core/import/import-errors";

export const lifecycleActions = ["blank", "rename", "duplicate", "delete"] as const;

export type LifecycleAction = (typeof lifecycleActions)[number];

/**
 * Every expected failure of each lifecycle action. `name-blank` is the import's kind,
 * `template-not-found` is `DbRefusal`'s, and `*-failed` is a thrown action caught in the client.
 */
export const lifecycleErrorKinds = {
  blank: ["name-blank", "blank-failed"],
  rename: ["name-blank", "template-not-found", "rename-failed"],
  duplicate: ["template-not-found", "duplicate-failed"],
  delete: ["delete-failed"],
} as const satisfies Record<LifecycleAction, readonly string[]>;

export type LifecycleErrorKind<A extends LifecycleAction = LifecycleAction> = (typeof lifecycleErrorKinds)[A][number];

export type LifecycleError<A extends LifecycleAction = LifecycleAction> = { kind: LifecycleErrorKind<A> };

const nameBlank = importErrorMessage({ kind: "name-blank" });

const messages: { [A in LifecycleAction]: Record<LifecycleErrorKind<A>, string> } = {
  blank: {
    "name-blank": nameBlank,
    "blank-failed": "The Template wasn't created. Try again.",
  },
  rename: {
    "name-blank": nameBlank,
    "template-not-found": "This Template doesn't exist any more. It may have been deleted.",
    "rename-failed": "Rename didn't go through. Try again.",
  },
  duplicate: {
    "template-not-found": "This Template doesn't exist any more, so it can't be duplicated.",
    "duplicate-failed": "Duplicate didn't go through. Try again.",
  },
  delete: {
    "delete-failed": "Delete didn't go through. Try again.",
  },
};

/** The message for a refused or failed lifecycle action. Wording differs by action for the same kind. */
export function lifecycleErrorMessage<A extends LifecycleAction>(action: A, error: LifecycleError<A>): string {
  const byKind: Record<LifecycleErrorKind<A>, string> = messages[action];
  return byKind[error.kind];
}
