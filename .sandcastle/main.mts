// Sequential Reviewer: implement-then-review loop, provider-switchable.
//
// Per iteration:
//   Phase 1 (Implement): an agent picks the highest-priority open GitHub issue
//     labelled `ready-for-agent`, implements it on a fresh branch, commits.
//   Phase 2 (Review): an agent reviews that branch's diff and fixes it in place.
// Both phases share one Docker sandbox. The loop stops early when an implement
// phase produces no commits (backlog empty or everything blocked).
//
// Examples:
//   npm run sandcastle                                   # claude / opus-5-5 / medium
//   npm run sandcastle -- --provider cursor              # cursor / grok-4.7 / high
//   npm run sandcastle -- --provider claude --effort high --iterations 3
//   npm run sandcastle -- --provider cursor --review-provider claude
//   npm run sandcastle -- --dry-run --provider cursor    # print config, run nothing

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { USAGE, checkCredentials, describe, parseRunConfig, resolveAgent } from "./agents.mts";

const GH_REPO = "vidhatatrivedy/hive-template-importer";

function fail(error: unknown): never {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  process.exit(1);
}

let config: Exclude<ReturnType<typeof parseRunConfig>, "help">;
try {
  const parsed = parseRunConfig(process.argv.slice(2));
  if (parsed === "help") {
    console.log(USAGE);
    process.exit(0);
  }
  config = parsed;
} catch (error) {
  fail(error);
}

console.log(`Implementer: ${describe(config.implementer)}`);
console.log(`Reviewer:    ${describe(config.reviewer)}`);
console.log(`Iterations:  ${config.iterations}`);
if (config.dryRun) process.exit(0);

try {
  checkCredentials([config.implementer, config.reviewer]);
} catch (error) {
  fail(error);
}

const implementer = resolveAgent(config.implementer);
const reviewer = resolveAgent(config.reviewer);

// The host remote uses an SSH alias the container can't resolve, so tell gh
// which repo to talk to explicitly.
const sandboxProvider = docker({ env: { GH_REPO } });

// npm install is a safety net for platform-specific binaries (host is macOS,
// sandbox is Linux) and packages added since node_modules was copied.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};
const copyToWorktree = ["node_modules"];

for (let iteration = 1; iteration <= config.iterations; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${config.iterations} ===\n`);

  const branch = `sandcastle/${config.implementer.provider}/${Date.now()}`;
  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: sandboxProvider,
    hooks,
    copyToWorktree,
  });

  try {
    const implement = await sandbox.run({
      name: `implementer:${config.implementer.provider}`,
      maxIterations: 1,
      agent: implementer,
      promptFile: "./.sandcastle/implement-prompt.md",
    });

    if (!implement.commits.length) {
      console.log("Implementation agent made no commits. Stopping.");
      break;
    }
    console.log(`\nImplementation complete on ${branch} (${implement.commits.length} commits)`);

    await sandbox.run({
      name: `reviewer:${config.reviewer.provider}`,
      maxIterations: 1,
      agent: reviewer,
      promptFile: "./.sandcastle/review-prompt.md",
      promptArgs: { BRANCH: branch },
    });
    console.log("\nReview complete.");
  } finally {
    await sandbox.close();
  }
}

console.log("\nAll done.");
