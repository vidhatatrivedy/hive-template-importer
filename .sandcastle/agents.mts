// Provider selection for Sandcastle runs.
//
// Every agent in .sandcastle/main.mts is built through `resolveAgent`, so the
// provider, model and effort are chosen per run from the command line (or env),
// never hard-coded. Supported providers: claude (Claude Code CLI) and cursor
// (Cursor Agent CLI). Both CLIs are installed in .sandcastle/Dockerfile.

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import * as sandcastle from "@ai-hero/sandcastle";

export type ProviderName = "claude" | "cursor";

export interface AgentChoice {
  provider: ProviderName;
  model: string;
  effort: string;
}

const DEFAULTS: Record<ProviderName, { model: string; effort: string }> = {
  claude: { model: "claude-opus-5-5", effort: "medium" },
  cursor: { model: "grok-4.7", effort: "high" },
};

// Any one of the keys in each inner list satisfies the provider.
const REQUIRED_ENV: Record<ProviderName, string[][]> = {
  claude: [["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]],
  cursor: [["CURSOR_API_KEY"]],
};

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface RunConfig {
  implementer: AgentChoice;
  reviewer: AgentChoice;
  iterations: number;
  dryRun: boolean;
}

export const USAGE = `
Usage: npm run sandcastle -- [options]

  --provider <claude|cursor>   Agent provider for both phases (default: claude)
  --model <id>                 Model id (default: claude-opus-5-5 | grok-4.7)
  --effort <level>             Reasoning effort (default: medium | high)
  --review-provider <name>     Provider for the review phase (default: --provider)
  --review-model <id>          Model for the review phase
  --review-effort <level>      Effort for the review phase
  --iterations <n>             Max implement->review cycles (default: 10)
  --dry-run                    Print the resolved config and exit
  -h, --help                   Show this help

Env fallbacks: SANDCASTLE_PROVIDER, SANDCASTLE_MODEL, SANDCASTLE_EFFORT.
Credentials are read from .sandcastle/.env (see .sandcastle/.env.example).
`;

function parseProvider(value: string | undefined, flag: string): ProviderName | undefined {
  if (value === undefined) return undefined;
  if (value === "claude" || value === "cursor") return value;
  throw new Error(`${flag} must be "claude" or "cursor", got "${value}"`);
}

function choose(
  provider: ProviderName,
  model: string | undefined,
  effort: string | undefined,
): AgentChoice {
  const chosenEffort = effort ?? DEFAULTS[provider].effort;
  if (provider === "claude" && !(CLAUDE_EFFORTS as readonly string[]).includes(chosenEffort)) {
    throw new Error(`Claude effort must be one of ${CLAUDE_EFFORTS.join(", ")}, got "${chosenEffort}"`);
  }
  return { provider, model: model ?? DEFAULTS[provider].model, effort: chosenEffort };
}

export function parseRunConfig(argv: string[]): RunConfig | "help" {
  const { values } = parseArgs({
    args: argv,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      "review-provider": { type: "string" },
      "review-model": { type: "string" },
      "review-effort": { type: "string" },
      iterations: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) return "help";

  const provider =
    parseProvider(values.provider, "--provider") ??
    parseProvider(process.env.SANDCASTLE_PROVIDER, "SANDCASTLE_PROVIDER") ??
    "claude";
  const model = values.model ?? process.env.SANDCASTLE_MODEL;
  const effort = values.effort ?? process.env.SANDCASTLE_EFFORT;
  const implementer = choose(provider, model, effort);

  const reviewProvider = parseProvider(values["review-provider"], "--review-provider") ?? provider;
  // Only inherit model/effort when the review phase uses the same provider;
  // a Claude model id means nothing to Cursor and vice versa.
  const sameProvider = reviewProvider === provider;
  const reviewer = choose(
    reviewProvider,
    values["review-model"] ?? (sameProvider ? model : undefined),
    values["review-effort"] ?? (sameProvider ? effort : undefined),
  );

  const iterations = Number(values.iterations ?? 10);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`--iterations must be a positive integer, got "${values.iterations}"`);
  }

  return { implementer, reviewer, iterations, dryRun: values["dry-run"] };
}

/** Load .sandcastle/.env into process.env (existing vars win) and fail fast on missing keys. */
export function checkCredentials(choices: AgentChoice[]): void {
  const envPath = new URL("./.env", import.meta.url);
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  const missing: string[] = [];
  const providers = new Set(choices.map((c) => c.provider));
  for (const provider of providers) {
    for (const anyOf of REQUIRED_ENV[provider]) {
      if (!anyOf.some((key) => process.env[key])) missing.push(`${provider}: one of ${anyOf.join(" / ")}`);
    }
  }
  if (!process.env.GH_TOKEN) missing.push("github issues: GH_TOKEN");

  if (missing.length) {
    throw new Error(
      `Missing credentials in .sandcastle/.env:\n  - ${missing.join("\n  - ")}\n` +
        "Copy .sandcastle/.env.example to .sandcastle/.env and fill them in.",
    );
  }
}

/** Build the Sandcastle agent provider for a choice. */
export function resolveAgent(choice: AgentChoice): sandcastle.AgentProvider {
  switch (choice.provider) {
    case "claude":
      return sandcastle.claudeCode(choice.model, {
        effort: choice.effort as (typeof CLAUDE_EFFORTS)[number],
      });
    case "cursor":
      // The Cursor CLI takes effort as a parameterized model id: model[effort=high].
      // A model id that already has brackets is passed through untouched.
      return sandcastle.cursor(
        choice.model.includes("[") ? choice.model : `${choice.model}[effort=${choice.effort}]`,
      );
  }
}

export function describe(choice: AgentChoice): string {
  return `${choice.provider} / ${choice.model} / effort=${choice.effort}`;
}
