import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assignEnvFile } from "./env-file";

loadEnvLocal();

const url = process.env.SUPABASE_URL;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!url || !process.env.SUPABASE_SECRET_KEY || !dbUrl) {
  console.error("SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_DB_URL must be set");
  process.exit(1);
}

console.log(new URL(url).host);

run("npm", ["run", "db:reset"]);
run("npx", ["vitest", "run", "--config", "vitest.db.config.mts"]);

function loadEnvLocal() {
  const file = path.resolve(".env.local");
  if (!fs.existsSync(file)) return;
  assignEnvFile(file);
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
