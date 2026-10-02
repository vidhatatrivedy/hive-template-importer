"use client";

import { useSyncExternalStore } from "react";
import {
  applyCollapseColumns,
  readCollapseColumnsCookie,
  subscribeToCollapseColumns,
} from "@/app/collapse-columns";
import { Tooltip } from "@/app/ui/tooltip";

const TIP_ID = "collapse-columns-tip";
const TIP = "Picking a Section or Item collapses its column.";

/**
 * Off by default. The server prop paints the first response; after that the cookie wins,
 * including when the Template list resolving remounts this switch before the next request.
 */
export function CollapseColumnsSwitch({ enabled }: { enabled: boolean }) {
  const on = useSyncExternalStore(subscribeToCollapseColumns, readCollapseColumnsCookie, () => enabled);
  const track = on
    ? "bg-neutral-900 dark:bg-white"
    : "border border-black/[0.08] dark:border-white/[0.1]";
  return (
    <div className="flex h-6 items-center gap-1.5">
      <button
        id="collapse-columns"
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="collapse-columns-label"
        className={`relative h-4 w-7 shrink-0 rounded-full ${track}`}
        onClick={() => applyCollapseColumns(!on)}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 size-3 rounded-full ${
            on ? "right-0.5 bg-white dark:bg-neutral-900" : "left-0.5 bg-neutral-400"
          }`}
        />
      </button>
      <label
        id="collapse-columns-label"
        htmlFor="collapse-columns"
        className="text-[11px] text-neutral-700 dark:text-neutral-200"
      >
        Collapse columns
      </label>
      <Tooltip id={TIP_ID} content={TIP}>
        <button
          type="button"
          aria-label="About Collapse columns"
          className="inline-flex size-4 items-center justify-center text-[12px] leading-none text-neutral-400"
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
      </Tooltip>
    </div>
  );
}
