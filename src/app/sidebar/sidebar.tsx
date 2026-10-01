"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { parseOpenTemplate, sidebarLine, type ActionTarget } from "@/app/sidebar/sidebar-view";
import { TemplateActions } from "@/app/sidebar/template-actions";
import { templateHref } from "@/app/template-view";
import { GuardedLink } from "@/app/unsaved-guard";
import { buttonClass, glassClass, labelClass, rowActiveClass, rowIdleClass } from "@/app/ui/classes";
import type { TemplateSummary } from "@/db/schemas";

export type SidebarList =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "loaded"; summaries: TemplateSummary[] };

/**
 * A 44px glass strip that widens to 240px on hover or keyboard focus. It overlays the page
 * instead of widening the row, so the editor's columns never reflow.
 */
export function Sidebar({ list }: { list: SidebarList }) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <aside
      aria-label="Templates"
      className={`${glassClass} group absolute top-3 bottom-3 left-3 z-30 flex flex-col overflow-hidden rounded-2xl transition-[width] duration-150 ${
        actionsOpen ? "w-60" : "w-11 focus-within:w-60 hover:w-60"
      }`}
    >
      <div className="flex w-60 shrink-0 flex-col gap-2 py-3">
        <div className="flex items-center">
          <Glyph>☰</Glyph>
          <span className={labelClass}>Templates</span>
        </div>
        <div className="flex items-center">
          <Glyph>+</Glyph>
          <span className={`${labelClass} mr-2`}>New</span>
          <GuardedLink href="/import" className={buttonClass}>
            Import…
          </GuardedLink>
        </div>
      </div>
      <div
        className={`w-60 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 transition-opacity ${
          actionsOpen ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        }`}
      >
        <SidebarContent list={list} onActionsOpenChange={setActionsOpen} />
      </div>
    </aside>
  );
}

function SidebarContent({
  list,
  onActionsOpenChange,
}: {
  list: SidebarList;
  onActionsOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  if (list.state === "loading") return null;
  if (list.state === "failed") {
    return (
      <div className="flex flex-col items-start gap-2 px-1.5">
        <p className="text-neutral-500">{"Templates couldn't be loaded."}</p>
        <button type="button" className={buttonClass} onClick={() => router.refresh()}>
          Retry
        </button>
      </div>
    );
  }
  if (list.summaries.length === 0) return <p className="px-1.5 text-neutral-500">No Templates yet.</p>;
  return <TemplateRows summaries={list.summaries} onActionsOpenChange={onActionsOpenChange} />;
}

/** Rows in `listTemplates()` order, never re-sorted. The "⋯" sits outside the link. */
function TemplateRows({
  summaries,
  onActionsOpenChange,
}: {
  summaries: TemplateSummary[];
  onActionsOpenChange: (open: boolean) => void;
}) {
  const openId = parseOpenTemplate(usePathname())?.templateId;
  return (
    <ul className="flex flex-col gap-px">
      {summaries.map((summary) => {
        const active = summary.id === openId;
        const target: ActionTarget = { id: summary.id, name: summary.name, latestNumber: summary.latest.number };
        return (
          <li key={summary.id} className="group/row relative">
            <GuardedLink
              href={templateHref(summary.id, { panes: new Set(), row: null })}
              title={summary.name}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col rounded-lg py-1 pr-7 pl-1.5 ${active ? rowActiveClass : rowIdleClass}`}
            >
              <span className="truncate text-neutral-900 dark:text-white">{summary.name}</span>
              <SidebarLine summary={summary} />
            </GuardedLink>
            <TemplateActions
              target={target}
              placement="row"
              revealed={active}
              onOpenChange={onActionsOpenChange}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** "Imported · 2h ago", computed in the browser so the server never renders a time. */
function SidebarLine({ summary }: { summary: TemplateSummary }) {
  const now = useNow();
  return (
    <span className="truncate text-[10px] text-neutral-400">{now === null ? " " : sidebarLine(summary, new Date(now))}</span>
  );
}

function Glyph({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="flex w-11 shrink-0 justify-center text-[13px] text-neutral-500">
      {children}
    </span>
  );
}

/** The browser's clock, ticking every minute. Null on the server and during hydration. */
function useNow(): number | null {
  return useSyncExternalStore(subscribeToClock, readClock, () => null);
}

const CLOCK_TICK_MS = 60_000;
const clockListeners = new Set<() => void>();
let clockNow: number | null = null;
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === undefined) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, CLOCK_TICK_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size > 0 || clockTimer === undefined) return;
    clearInterval(clockTimer);
    clockTimer = undefined;
    clockNow = null;
  };
}

function readClock(): number {
  clockNow ??= Date.now();
  return clockNow;
}
