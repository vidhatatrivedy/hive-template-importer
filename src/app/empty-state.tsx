"use client";

import Link from "next/link";
import { useState } from "react";
import { BlankDialog } from "@/app/sidebar/blank-dialog";
import { buttonClass, glassClass, primaryButtonClass } from "@/app/ui/classes";

/** Shown on `/` when the inspector has no Templates. Import leaves; Blank opens the same dialog as the sidebar. */
export function EmptyState() {
  const [blankOpen, setBlankOpen] = useState(false);

  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className={`${glassClass} flex max-w-md flex-col items-start gap-3 rounded-2xl px-8 py-6`}>
        <p className="text-neutral-900 dark:text-white">No Templates yet.</p>
        <p className="text-neutral-500">
          Import a Spectora export, or start a blank Template and build it by hand.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/import" className={primaryButtonClass}>
            Import a Spectora export
          </Link>
          <button type="button" className={buttonClass} onClick={() => setBlankOpen(true)}>
            Blank Template
          </button>
        </div>
      </div>
      {blankOpen ? <BlankDialog onClose={() => setBlankOpen(false)} /> : null}
    </main>
  );
}
