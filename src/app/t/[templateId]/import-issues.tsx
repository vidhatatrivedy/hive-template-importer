"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { IssueClass, IssueSeverity } from "@/core/import/catalogue";
import { filterIssueGroups, type LinkedImportIssueGroup } from "@/app/trust-issues";
import { buttonClass, labelClass, severityClass } from "@/app/ui/classes";

/** Filter chips and expand state for the Import issues list. Issues in a closed group are not rendered. */
export function ImportIssues({
  severities,
  classes,
  groups,
}: {
  severities: readonly IssueSeverity[];
  classes: readonly IssueClass[];
  groups: readonly LinkedImportIssueGroup[];
}) {
  const [selectedSeverities, setSelectedSeverities] = useState(() => new Set(severities));
  const [selectedClasses, setSelectedClasses] = useState(() => new Set(classes));
  const [openKinds, setOpenKinds] = useState(
    () => new Set(groups.filter((group) => group.open).map((group) => group.kind)),
  );

  const visible = filterIssueGroups(groups, {
    severities: [...selectedSeverities],
    classes: [...selectedClasses],
  });

  function toggleSeverity(severity: IssueSeverity) {
    setSelectedSeverities((current) => toggleSet(current, severity));
  }

  function toggleClass(issueClass: IssueClass) {
    setSelectedClasses((current) => toggleSet(current, issueClass));
  }

  function toggleOpen(kind: LinkedImportIssueGroup["kind"]) {
    setOpenKinds((current) => toggleSet(current, kind));
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className={labelClass}>Import issues</h3>
      <div className="flex flex-col gap-1">
        <ChipRow label="Severity">
          {severities.map((severity) => (
            <FilterChip
              key={severity}
              pressed={selectedSeverities.has(severity)}
              onClick={() => toggleSeverity(severity)}
            >
              {severity}
            </FilterChip>
          ))}
        </ChipRow>
        <ChipRow label="Class">
          {classes.map((issueClass) => (
            <FilterChip
              key={issueClass}
              pressed={selectedClasses.has(issueClass)}
              onClick={() => toggleClass(issueClass)}
            >
              {issueClass}
            </FilterChip>
          ))}
        </ChipRow>
      </div>
      {visible.map((group) => {
        const open = openKinds.has(group.kind);
        return (
          <div key={group.kind} className="border-b border-black/[0.05] py-1 last:border-b-0 dark:border-white/[0.06]">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggleOpen(group.kind)}
              className="flex w-full cursor-pointer items-baseline justify-between gap-2 text-left"
            >
              <span className={severityClass[group.severity]}>
                {group.severity} · {group.class} · {group.title}
              </span>
              <span className="shrink-0 tabular-nums text-neutral-500">{group.count}</span>
            </button>
            {open ? (
              <ul className="mt-1 flex flex-col gap-2 pl-3">
                {group.issues.map((issue, index) => {
                  const href = issue.href;
                  const sourceRow = issue.sourceRow;
                  const hasContext = issue.location !== null || href !== null;
                  return (
                    <li key={`${sourceRow ?? "file"}-${index}`} className="flex flex-col gap-0.5">
                      {issue.location ? <p>{issue.location}</p> : null}
                      {href !== null && sourceRow !== null ? (
                        <p>
                          <Link href={href} className="underline underline-offset-2">
                            Source row {sourceRow}
                          </Link>
                        </p>
                      ) : null}
                      <p className={hasContext ? "text-neutral-500" : undefined}>{issue.message}</p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {children}
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`${buttonClass} ${pressed ? "bg-black/[0.06] dark:bg-white/[0.1]" : ""}`}
    >
      {children}
    </button>
  );
}

function toggleSet<Value>(current: Set<Value>, value: Value): Set<Value> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
