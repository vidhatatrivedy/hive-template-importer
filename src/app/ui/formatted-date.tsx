"use client";

import { useSyncExternalStore } from "react";
import { formatDate } from "@/app/ui/format-date";

/**
 * Medium date and short time in the viewer's locale and time zone.
 * The SHA-256 notice passes `dateOnly`. The server renders an empty
 * time so the viewer's zone is the only one that shows.
 */
export function FormattedDate({ value, dateOnly = false }: { value: string; dateOnly?: boolean }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatDate(value, dateOnly),
    () => "",
  );
  return <time dateTime={value}>{text}</time>;
}

function subscribe() {
  return () => {};
}
