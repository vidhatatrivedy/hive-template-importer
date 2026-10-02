import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/app/empty-state";
import { landingTarget } from "@/app/sidebar/sidebar-view";
import { getDb } from "@/db/server";

/** Opens the last-saved Template, or the empty state. The list is read per request, never at build time. */
export default function Home() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}

async function Landing() {
  await connection();
  const target = landingTarget(await getDb().listTemplates());
  if (target !== null) redirect(target);
  return <EmptyState />;
}
