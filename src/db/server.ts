// Throws in a Client Component bundle. Empty when tsx, Vitest or a Server Component loads it.
import "server-only";
import { createDb, type Db } from "@/db";

let db: Db | undefined;

/** Builds one client from `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, then reuses it. */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }
  db = createDb({ url, serviceRoleKey });
  return db;
}
