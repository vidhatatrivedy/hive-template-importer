"use client";

import { cloneElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { glassClass } from "@/app/ui/classes";

const MARGIN = 8;
const GAP = 4;

/** Keeps a tooltip on screen: below the trigger when it fits, otherwise above, clamped to the viewport. */
export function tooltipPosition(
  anchor: { top: number; bottom: number; left: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.bottom + GAP;
  const fitsBelow = below + tip.height <= viewport.height - MARGIN;
  const top = fitsBelow ? below : Math.max(MARGIN, anchor.top - GAP - tip.height);
  const maxLeft = Math.max(MARGIN, viewport.width - tip.width - MARGIN);
  const left = Math.min(Math.max(MARGIN, anchor.left), maxLeft);
  return { top, left };
}

/** Glass tooltip. Opens from its trigger on hover or focus, and never takes focus itself. */
export function Tooltip({
  id,
  content,
  children,
}: {
  id: string;
  content: ReactNode;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const rect = anchor.getBoundingClientRect();
    const place = tooltipPosition(
      { top: rect.top, bottom: rect.bottom, left: rect.left },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    tip.style.top = `${place.top}px`;
    tip.style.left = `${place.left}px`;
    tip.style.visibility = "visible";
  }, [open, content]);

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      {cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": open ? id : undefined,
      })}
      {open
        ? createPortal(
            <span
              ref={tipRef}
              id={id}
              role="tooltip"
              style={{ visibility: "hidden" }}
              className={`${glassClass} pointer-events-none fixed z-50 max-w-sm rounded-md px-2 py-1 text-[12px] leading-snug`}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
