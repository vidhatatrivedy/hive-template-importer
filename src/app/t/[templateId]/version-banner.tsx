import { GuardedLink } from "@/app/unsaved-guard";
import { buttonClass } from "@/app/ui/classes";
import { FormattedDate } from "@/app/ui/formatted-date";

/** Across the editor while an old Version is open. */
export function VersionBanner({
  number,
  label,
  savedAt,
  backHref,
}: {
  number: number;
  label: string;
  savedAt: string;
  backHref: string;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-black/[0.05] px-4 dark:border-white/[0.06]">
      <p className="min-w-0 flex-1 truncate">
        Viewing Version {number} · {label} · <FormattedDate value={savedAt} />
      </p>
      <GuardedLink href={backHref} className={`${buttonClass} shrink-0`}>
        Back to current
      </GuardedLink>
    </div>
  );
}
