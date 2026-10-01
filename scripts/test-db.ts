import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
