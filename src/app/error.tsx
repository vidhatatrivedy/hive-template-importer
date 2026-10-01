"use client";

import { glassClass, primaryButtonClass } from "@/app/ui/classes";

export default function ErrorScreen({ retry }: { error: unknown; reset: () => void; retry: () => void }) {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className={`${glassClass} flex flex-col items-start gap-3 rounded-2xl px-8 py-6`}>
        <p>Something went wrong.</p>
        <button type="button" className={primaryButtonClass} onClick={() => retry()}>
          Retry
        </button>
      </div>
    </main>
  );
}
