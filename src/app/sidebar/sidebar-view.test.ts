import { describe, expect, it } from "vitest";
import {
  blankPlan,
  duplicateConfirm,
  landingTarget,
  lifecyclePrompt,
  parseOpenTemplate,
  relativeTime,
  renamePlan,
  sidebarLine,
  type ActionTarget,
  type OpenTemplate,
} from "@/app/sidebar/sidebar-view";
import { formatDate } from "@/app/ui/format-date";
import type { TemplateSummary } from "@/db/schemas";

const templateId = "6b1e0c3a-6e3d-4f3a-9c2e-1a2b3c4d5e6f";
const now = new Date("2026-10-01T12:00:00.000Z");

function ago(seconds: number): string {
  return new Date(now.getTime() - seconds * 1000).toISOString();
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1m ago"],
    [59 * MINUTE, "59m ago"],
    [HOUR, "1h ago"],
    [23 * HOUR, "23h ago"],
    [24 * HOUR, "yesterday"],
    [47 * HOUR, "yesterday"],
    [48 * HOUR, "2 days ago"],
    [6 * DAY, "6 days ago"],
  ])("%i seconds ago is %s", (seconds, expected) => {
    expect(relativeTime(ago(seconds), now)).toBe(expected);
  });

  it("says just now for a time in the future", () => {
    expect(relativeTime(ago(-5 * MINUTE), now)).toBe("just now");
  });

  it("shows the date alone from 7 days on", () => {
    const iso = ago(7 * DAY);
    expect(relativeTime(iso, now)).toBe(formatDate(iso, true));
    expect(relativeTime(iso, now)).not.toContain("ago");
  });
});

describe("sidebarLine", () => {
  const base: TemplateSummary = {
    id: templateId,
    name: "InterNACHI Residential",
    creation: "import",
    copiedFromName: null,
    importRun: {
      id: "0d0c0b0a-0000-4000-8000-000000000001",
      filename: "internachi.xlsx",
      sha256: "a".repeat(64),
      importedAt: ago(2 * HOUR),
    },
    latest: { id: "0d0c0b0a-0000-4000-8000-000000000002", number: 1, savedAt: ago(2 * HOUR) },
  };

  it("says an import was imported", () => {
    expect(sidebarLine(base, now)).toBe("Imported · 2h ago");
  });

  it("says a Blank is blank", () => {
    expect(sidebarLine({ ...base, creation: "blank", importRun: null, latest: { ...base.latest, savedAt: ago(30) } }, now)).toBe(
      "Blank · just now",
    );
  });

  it("names a Copy's source by the snapshot name, so a later rename doesn't change it", () => {
    const copy: TemplateSummary = {
      ...base,
      name: "Renamed copy",
      creation: "copy",
      copiedFromName: "InterNACHI Residential",
      importRun: null,
      latest: { ...base.latest, savedAt: ago(3 * DAY) },
    };
    expect(sidebarLine(copy, now)).toBe("Copy of InterNACHI Residential · 3 days ago");
  });
});

describe("landingTarget", () => {
  const base: TemplateSummary = {
    id: templateId,
    name: "InterNACHI Residential",
    creation: "import",
    copiedFromName: null,
    importRun: null,
    latest: { id: "0d0c0b0a-0000-4000-8000-000000000002", number: 1, savedAt: ago(2 * HOUR) },
  };
  const olderId = "0d9f8e7c-1111-4222-8333-444455556666";

  it("opens the first summary with no panes or row", () => {
    expect(landingTarget([base, { ...base, id: olderId, name: "Older" }])).toBe(`/t/${templateId}`);
  });

  it("is null when there are no Templates", () => {
    expect(landingTarget([])).toBeNull();
  });
});

describe("parseOpenTemplate", () => {
  it.each([
    [`/t/${templateId}`, { templateId, viewingVersion: null }],
    [`/t/${templateId}/`, { templateId, viewingVersion: null }],
    [`/t/${templateId}/v/3`, { templateId, viewingVersion: 3 }],
    [`/t/${templateId}/v/3/`, { templateId, viewingVersion: 3 }],
    [`/t/${templateId}/v/abc`, { templateId, viewingVersion: null }],
    ["/", null],
    ["/import", null],
    ["/t/", null],
    ["/t", null],
  ])("%s", (pathname, expected) => {
    expect(parseOpenTemplate(pathname)).toEqual(expected);
  });

  it("decodes the id the way templateHref encodes it", () => {
    expect(parseOpenTemplate("/t/a%20b")).toEqual({ templateId: "a b", viewingVersion: null });
  });
});

describe("blankPlan", () => {
  it("refuses a blank name, including spaces and a non-breaking space", () => {
    expect(blankPlan("")).toEqual({ kind: "blank" });
    expect(blankPlan("   ")).toEqual({ kind: "blank" });
    expect(blankPlan("\u00a0")).toEqual({ kind: "blank" });
    expect(blankPlan(" \u00a0 ")).toEqual({ kind: "blank" });
  });

  it("creates a Template from the trimmed name", () => {
    expect(blankPlan("  Kitchen  ")).toEqual({ kind: "create", name: "Kitchen" });
    expect(blankPlan("\u00a0Kitchen fan\u00a0")).toEqual({ kind: "create", name: "Kitchen fan" });
  });
});

describe("renamePlan", () => {
  it("refuses a blank name, including spaces and a non-breaking space", () => {
    expect(renamePlan("Kitchen", "")).toEqual({ kind: "blank" });
    expect(renamePlan("Kitchen", "   ")).toEqual({ kind: "blank" });
    expect(renamePlan("Kitchen", "\u00a0")).toEqual({ kind: "blank" });
    expect(renamePlan("Kitchen", " \u00a0 ")).toEqual({ kind: "blank" });
  });

  it("closes without saving when the trimmed name is the current name", () => {
    expect(renamePlan("Kitchen", "Kitchen")).toEqual({ kind: "unchanged" });
    expect(renamePlan("Kitchen", "  Kitchen  ")).toEqual({ kind: "unchanged" });
    expect(renamePlan("InterNACHI Residential", "\u00a0InterNACHI Residential\u00a0")).toEqual({
      kind: "unchanged",
    });
  });

  it("stores the trimmed name when it changed", () => {
    expect(renamePlan("Kitchen", "  Bath  ")).toEqual({ kind: "rename", name: "Bath" });
    expect(renamePlan("Kitchen", "\u00a0Kitchen fan")).toEqual({ kind: "rename", name: "Kitchen fan" });
  });
});

describe("lifecyclePrompt", () => {
  const target: ActionTarget = { id: templateId, name: "InterNACHI Residential", latestNumber: 4 };
  const other: ActionTarget = { id: "0d9f8e7c-1111-4222-8333-444455556666", name: "Radon", latestNumber: 1 };
  const editing: OpenTemplate = { templateId, viewingVersion: null };
  const viewing: OpenTemplate = { templateId, viewingVersion: 3 };

  it("Blank asks to discard only when there are unsaved edits", () => {
    expect(lifecyclePrompt("blank", null, { open: editing, dirty: false })).toEqual({ kind: "none" });
    expect(lifecyclePrompt("blank", null, { open: editing, dirty: true })).toEqual({ kind: "discard" });
    expect(lifecyclePrompt("blank", null, { open: null, dirty: false })).toEqual({ kind: "none" });
  });

  it("Duplicate of the open Template runs clean and warns when dirty", () => {
    expect(lifecyclePrompt("duplicate", target, { open: editing, dirty: false })).toEqual({ kind: "none" });
    expect(lifecyclePrompt("duplicate", target, { open: editing, dirty: true })).toEqual({
      kind: "duplicate-unsaved",
      name: "InterNACHI Residential",
      latestNumber: 4,
    });
  });

  it("Duplicate from the read-only view says the Copy is made from the latest Version", () => {
    expect(lifecyclePrompt("duplicate", target, { open: viewing, dirty: false })).toEqual({
      kind: "duplicate-viewing",
      name: "InterNACHI Residential",
      viewing: 3,
      latestNumber: 4,
    });
  });

  it("Duplicate of another Template runs clean and asks to discard when dirty", () => {
    expect(lifecyclePrompt("duplicate", other, { open: editing, dirty: false })).toEqual({ kind: "none" });
    expect(lifecyclePrompt("duplicate", other, { open: editing, dirty: true })).toEqual({ kind: "discard" });
    expect(lifecyclePrompt("duplicate", other, { open: null, dirty: false })).toEqual({ kind: "none" });
  });

  it("Delete of the open Template leaves, and loses edits only when dirty", () => {
    expect(lifecyclePrompt("delete", target, { open: editing, dirty: false })).toEqual({
      kind: "delete",
      name: "InterNACHI Residential",
      versions: 4,
      losesEdits: false,
      leaves: true,
    });
    expect(lifecyclePrompt("delete", target, { open: editing, dirty: true })).toEqual({
      kind: "delete",
      name: "InterNACHI Residential",
      versions: 4,
      losesEdits: true,
      leaves: true,
    });
  });

  it("Delete of another Template while dirty stays and keeps the edits", () => {
    expect(lifecyclePrompt("delete", other, { open: editing, dirty: true })).toEqual({
      kind: "delete",
      name: "Radon",
      versions: 1,
      losesEdits: false,
      leaves: false,
    });
  });
});

describe("duplicateConfirm", () => {
  it("warns that unsaved edits will not be in the Copy and offers to keep editing", () => {
    expect(
      duplicateConfirm({
        kind: "duplicate-unsaved",
        name: "InterNACHI Residential",
        latestNumber: 4,
      }),
    ).toEqual({
      message:
        "Duplicate 'InterNACHI Residential'? The Copy is made from Version 4, the last saved Version. Your unsaved changes won't be in it and will be discarded.",
      confirmLabel: "Duplicate",
      cancelLabel: "Keep editing",
    });
  });

  it("says the Copy is made from the latest Version, not the one being viewed", () => {
    expect(
      duplicateConfirm({
        kind: "duplicate-viewing",
        name: "InterNACHI Residential",
        viewing: 3,
        latestNumber: 4,
      }),
    ).toEqual({
      message:
        "Duplicate 'InterNACHI Residential'? The Copy is made from Version 4, the latest Version, not Version 3 you're viewing.",
      confirmLabel: "Duplicate",
      cancelLabel: "Cancel",
    });
  });
});
