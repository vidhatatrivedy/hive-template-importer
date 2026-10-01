import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/db/server";
import { Sidebar, type SidebarList } from "@/app/sidebar/sidebar";

/**
 * The Template list beside every page. Loaded per request, never at build time, and a failed
 * load stays inside the sidebar: the root layout's errors don't reach `error.tsx`.
 */
export function TemplateSidebar() {
  return (
    <Suspense fallback={<Sidebar list={{ state: "loading" }} />}>
      <LoadedSidebar />
    </Suspense>
  );
}

async function LoadedSidebar() {
  await connection();
  return <Sidebar list={await loadList()} />;
}

async function loadList(): Promise<SidebarList> {
  try {
    return { state: "loaded", summaries: await getDb().listTemplates() };
  } catch (error) {
    console.error("Templates couldn't be loaded", error);
    return { state: "failed" };
  }
}
