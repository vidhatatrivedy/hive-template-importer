import Link from "next/link";
import { glassClass, primaryButtonClass } from "@/app/ui/classes";

export default function NotFound() {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className={`${glassClass} flex flex-col items-start gap-3 rounded-2xl px-8 py-6`}>
        <p>{"This Template doesn't exist. It may have been deleted."}</p>
        <Link href="/" className={primaryButtonClass}>
          Go to your Templates
        </Link>
      </div>
    </main>
  );
}
