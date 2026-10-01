import { describe, expect, it } from "vitest";
import { parseOpenTemplate, relativeTime, sidebarLine } from "@/app/sidebar/sidebar-view";
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
