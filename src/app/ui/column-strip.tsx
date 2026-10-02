import { labelClass } from "@/app/ui/classes";

/** Collapsed Sections or Items column: selection pinned to the top, label at the bottom. */
export function ColumnStrip({
  title,
  stripText,
  onFocus,
}: {
  title: string;
  stripText: string;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFocus}
      aria-label={stripText ? `${title}, ${stripText}` : title}
      className="flex h-full min-h-0 w-9 shrink-0 flex-col items-center gap-3 py-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
    >
      <span className="max-h-[70%] truncate text-[11px] text-neutral-600 [writing-mode:vertical-rl] rotate-180 dark:text-neutral-300">
        {stripText}
      </span>
      <span className={`${labelClass} mt-auto shrink-0 [writing-mode:vertical-rl] rotate-180`}>{title}</span>
    </button>
  );
}
