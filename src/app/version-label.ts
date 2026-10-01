import type { VersionOrigin } from "@/db/schemas";

/** The Version and the Template facts an origin label can name. */
export type VersionLabelInput = {
  origin: VersionOrigin;
  restoredFromNumber: number | null;
};

export type VersionLabelDetail = {
  importRun: { filename: string } | null;
  copiedFrom: { templateName: string; versionNumber: number } | null;
};

/** How a Version came to exist, in the words the sheet and the banner use. */
export function versionLabel(version: VersionLabelInput, detail: VersionLabelDetail): string {
  switch (version.origin) {
    case "import":
      return detail.importRun ? `Imported from ${detail.importRun.filename}` : "Imported";
    case "blank":
      return "Created blank";
    case "copy":
      return detail.copiedFrom
        ? `Copied from ${detail.copiedFrom.templateName} v${detail.copiedFrom.versionNumber}`
        : "Copied";
    case "save":
      return "Saved";
    case "restore":
      return version.restoredFromNumber === null ? "Restored" : `Restored from v${version.restoredFromNumber}`;
  }
}
