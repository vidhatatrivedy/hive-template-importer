import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { issueKinds, type IssueKind } from "@/core/import/catalogue";
import { parseSpectoraExport } from "@/core/import/parse-spectora-export";
import { buildTrustReport } from "@/core/import/trust-report";
import type { ImportDraft } from "@/core/import/schemas";

const FIXTURE_DIR = path.resolve(__dirname, "../../../fixtures/spectora");

/**
 * Measured from the six HTML fixtures. A count that is absent is pinned at 0,
 * including `split-run` and `unsafe-style-removed`. `stock-estimates` is present
 * on every fixture. `valuesDecoded` is the same measurement as the run-metadata pin.
 * External assets are URL counts per host from `buildTrustReport`.
 */
const PINNED: Record<string, { valuesDecoded: number; issues: Partial<Record<IssueKind, number>>; hosts: Record<string, number> }> = {
  "InterNACHI Residential -2026-09-30.xls": {
    valuesDecoded: 252,
    issues: {
      "stock-estimates": 1,
      "whitespace-trimmed": 11,
      "duplicate-comment": 1,
      "youtube-wrapper-empty": 1,
    },
    hosts: {},
  },
  "Residential Template-2026-09-30.xls": {
    valuesDecoded: 252,
    issues: {
      "raw-only-content": 1,
      "stock-estimates": 1,
      "whitespace-trimmed": 11,
      "duplicate-comment": 1,
      "youtube-wrapper-empty": 1,
    },
    hosts: {},
  },
  "InterNACHI Commercial Template-2026-09-30.xls": {
    valuesDecoded: 199,
    issues: {
      "stock-estimates": 1,
      "whitespace-trimmed": 8,
      "youtube-wrapper-empty": 1,
    },
    hosts: {},
  },
  "Room-by-Room Residential Template-2026-09-30.xls": {
    valuesDecoded: 295,
    issues: {
      "stock-estimates": 1,
      "whitespace-trimmed": 21,
      "youtube-wrapper-empty": 7,
    },
    hosts: {},
  },
  "Ben Gromicko's Template for Home Inspections-2026-09-30.xls": {
    valuesDecoded: 561,
    issues: {
      "raw-only-content": 2,
      "stock-estimates": 1,
      "whitespace-trimmed": 15,
      "boolean-default-normalised": 12,
      "duplicate-comment": 7,
      "editor-leftovers": 38,
      "attribute-removed": 2,
    },
    hosts: { "cdn.spectora.com": 13, "www.youtube.com": 2 },
  },
  "Radon Inspection-2026-09-30.xls": {
    valuesDecoded: 0,
    issues: { "stock-estimates": 1 },
    hosts: {},
  },
};

function issueCounts(draft: ImportDraft): Record<IssueKind, number> {
  const counts = Object.fromEntries(issueKinds.map((kind) => [kind, 0])) as Record<IssueKind, number>;
  for (const issue of draft.issues) counts[issue.kind] += 1;
  return counts;
}

describe("pinned quirks", () => {
  it("pins every issue-kind count, values decoded, and External assets by host", async () => {
    for (const [file, pin] of Object.entries(PINNED)) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, file)));
      const result = await parseSpectoraExport(bytes, file);
      expect(result.ok, file).toBe(true);
      if (!result.ok) continue;

      const expected = Object.fromEntries(issueKinds.map((kind) => [kind, pin.issues[kind] ?? 0]));
      expect(issueCounts(result.draft), file).toEqual(expected);
      expect(result.draft.run.valuesDecoded, file).toBe(pin.valuesDecoded);
      expect(result.draft.issues.filter((issue) => issue.kind === "split-run"), file).toEqual([]);
      expect(result.draft.issues.filter((issue) => issue.kind === "unsafe-style-removed"), file).toEqual([]);
      expect(result.draft.issues.filter((issue) => issue.kind === "stock-estimates"), file).toHaveLength(1);

      const report = buildTrustReport(result.draft, result.draft.tree);
      const hosts = Object.fromEntries(report.externalAssets.map((host) => [host.host, host.urls.length]));
      expect(hosts, file).toEqual(pin.hosts);
    }
  });
});
