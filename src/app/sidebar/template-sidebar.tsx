import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/db/server";
import { Sidebar, type SidebarList } from "@/app/sidebar/sidebar";
import type { ThemeChoice } from "@/app/theme";

/**
 * The Template list beside every page. Loaded per request, never at build time, and a failed
 * load stays inside the sidebar: the root layout's errors don't reach `error.tsx`.
 */
export function TemplateSidebar({ theme, collapseColumns }: { theme: ThemeChoice; collapseColumns: boolean }) {
  return (
    <Suspense fallback={<Sidebar list={{ state: "loading" }} theme={theme} collapseColumns={collapseColumns} />}>
      <LoadedSidebar theme={theme} collapseColumns={collapseColumns} />
    </Suspense>
  );
}

async function LoadedSidebar({ theme, collapseColumns }: { theme: ThemeChoice; collapseColumns: boolean }) {
  await connection();
  return <Sidebar list={await loadList()} theme={theme} collapseColumns={collapseColumns} />;
}

async function loadList(): Promise<SidebarList> {
  try {
    return { state: "loaded", summaries: await getDb().listTemplates() };
  } catch (error) {
    console.error("Templates couldn't be loaded", error);
    return { state: "failed" };
  }
}
