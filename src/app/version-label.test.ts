import { describe, expect, it } from "vitest";
import { versionLabel } from "@/app/version-label";

const unrelated = { importRun: null, copiedFrom: null };

describe("versionLabel", () => {
  it("says where an imported Version 1 came from", () => {
    expect(
      versionLabel(
        { origin: "import", restoredFromNumber: null },
        { importRun: { filename: "InterNACHI Residential.xls" }, copiedFrom: null },
      ),
    ).toBe("Imported from InterNACHI Residential.xls");
  });

  it("says a Blank Template was created blank", () => {
    expect(versionLabel({ origin: "blank", restoredFromNumber: null }, unrelated)).toBe("Created blank");
  });

  it("names the Template and Version a Copy was taken from", () => {
    expect(
      versionLabel(
        { origin: "copy", restoredFromNumber: null },
        { importRun: null, copiedFrom: { templateName: "Residential", versionNumber: 3 } },
      ),
    ).toBe("Copied from Residential v3");
  });

  it("says a Save is Saved", () => {
    expect(versionLabel({ origin: "save", restoredFromNumber: null }, unrelated)).toBe("Saved");
  });

  it("names the Version a Restore came from", () => {
    expect(versionLabel({ origin: "restore", restoredFromNumber: 1 }, unrelated)).toBe("Restored from v1");
  });
});
