import { describe, expect, it } from "vitest";
import { importErrorMessage } from "@/core/import/import-errors";
import {
  lifecycleActions,
  lifecycleErrorKinds,
  lifecycleErrorMessage,
  type LifecycleAction,
} from "@/core/import/lifecycle-messages";

describe("lifecycle messages", () => {
  it("renders a non-empty message for every error kind of every action", () => {
    expect(lifecycleActions).toEqual(["blank", "rename", "duplicate", "delete"]);
    for (const action of lifecycleActions) {
      for (const kind of lifecycleErrorKinds[action] as readonly string[]) {
        const message = lifecycleErrorMessage(action as LifecycleAction, { kind } as never);
        expect(message.trim().length, `${action} ${kind}`).toBeGreaterThan(0);
      }
    }
  });

  it("reuses the import's name-blank kind and message for Blank and Rename", () => {
    const message = importErrorMessage({ kind: "name-blank" });
    expect(lifecycleErrorMessage("blank", { kind: "name-blank" })).toBe(message);
    expect(lifecycleErrorMessage("rename", { kind: "name-blank" })).toBe(message);
  });

  it("words every lifecycle error as the spec does", () => {
    expect(lifecycleErrorMessage("blank", { kind: "blank-failed" })).toBe("The Template wasn't created. Try again.");
    expect(lifecycleErrorMessage("rename", { kind: "template-not-found" })).toBe(
      "This Template doesn't exist any more. It may have been deleted.",
    );
    expect(lifecycleErrorMessage("rename", { kind: "rename-failed" })).toBe("Rename didn't go through. Try again.");
    expect(lifecycleErrorMessage("duplicate", { kind: "template-not-found" })).toBe(
      "This Template doesn't exist any more, so it can't be duplicated.",
    );
    expect(lifecycleErrorMessage("duplicate", { kind: "duplicate-failed" })).toBe(
      "Duplicate didn't go through. Try again.",
    );
    expect(lifecycleErrorMessage("delete", { kind: "delete-failed" })).toBe("Delete didn't go through. Try again.");
  });
});
