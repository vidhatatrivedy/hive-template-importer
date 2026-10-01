// Sequential Reviewer: implement-then-review loop, provider-switchable.
//
// Per iteration:
//   Phase 1 (Implement): an agent picks the highest-priority open GitHub issue
//     labelled `ready-for-agent`, implements it on a fresh branch, commits.
//   Phase 2 (Review): an agent reviews that branch's diff and fixes it in place.
//   Then this script closes the issue. Agents never close issues, so a closed
//   issue always means implemented and reviewed.
// Both phases share one Docker sandbox. The loop stops early when an implement
// phase produces no commits (backlog empty or everything blocked), or when an
// implement or review phase fails; the issue then stays open with a comment
// saying why.
// Iterations chain: each branch forks from the previous iteration's branch, so
// a ticket sees the code of the tickets closed before it. The first forks from
// the host's current HEAD. Nothing is merged to main; merge the last branch
// (it contains every earlier one) after reviewing it.
//
// Examples:
//   npm run sandcastle                                   # claude / opus-5-5 / medium
//   npm run sandcastle -- --provider cursor              # cursor / grok-4.7 / high
//   npm run sandcastle -- --provider claude --effort high --iterations 3
//   npm run sandcastle -- --provider cursor --review-provider claude
//   npm run sandcastle -- --dry-run --provider cursor    # print config, run nothing

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { USAGE, checkCredentials, describe, parseRunConfig, resolveAgent } from "./agents.mts";

const GH_REPO = "vidhatatrivedy/hive-template-importer";
// Cursor's CLI takes the prompt as one argv string capped at 120 KiB; stay under it.
const MAX_PROMPT_BYTES = 110 * 1024;
// Cursor reports no tool calls, so a long test run looks idle. Sandcastle's default is 600.
const IDLE_TIMEOUT_SECONDS = 30 * 60;
const REVIEW_PROMPT_FILE = "./.sandcastle/review-prompt.md";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The issue the implementer worked on, from its `RALPH: … (#N)` commit subject. */
function issueFromCommits(commits: readonly { sha: string }[]): number | undefined {
  for (const { sha } of commits) {
    const subject = execFileSync("git", ["log", "-1", "--format=%s", sha], { encoding: "utf8" });
    const match = /\(#(\d+)\)\s*$/.exec(subject.trim());
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** Commits on `branch` since `base`, oldest first; none if the branch doesn't exist. */
function branchCommits(base: string, branch: string): { sha: string }[] {
  try {
    const out = execFileSync("git", ["rev-list", "--reverse", `${base}..${branch}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean).map((sha) => ({ sha }));
  } catch {
    return [];
  }
}

/**
 * The review prompt's diff block: the full diff when the expanded prompt fits
 * MAX_PROMPT_BYTES, otherwise a file summary the reviewer drills into itself.
 */
function reviewDiffArgs(base: string, branch: string): { DIFF_COMMAND: string; DIFF_NOTE: string } {
  const range = `${base}...${branch}`;
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const bytes =
    readFileSync(REVIEW_PROMPT_FILE).byteLength +
    Buffer.byteLength(git(["diff", range])) +
    Buffer.byteLength(git(["log", `${base}..${branch}`, "--oneline"]));
  if (bytes <= MAX_PROMPT_BYTES) {
    return { DIFF_COMMAND: `git diff ${range}`, DIFF_NOTE: "The full diff:" };
  }
  console.log(`Review diff is too large to inline (~${Math.round(bytes / 1024)} KB); sending a file summary instead.`);
  return {
    DIFF_COMMAND: `git diff --stat=200 ${range}`,
    DIFF_NOTE:
      `The full diff is too large to include, so this is a per-file summary. ` +
      `Read each changed file's diff with \`git diff ${range} -- <path>\` before reviewing it.`,
  };
}

/** Runs gh on the host with the sandbox's GH_TOKEN (loaded by checkCredentials). */
function gh(args: string[]): void {
  execFileSync("gh", [...args, "--repo", GH_REPO], { stdio: "inherit" });
}

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

let previousBranch: string | undefined;
// The first iteration forks from this commit; the reviewer diffs against it.
const startCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

for (let iteration = 1; iteration <= config.iterations; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${config.iterations} ===\n`);

  const branch = `sandcastle/${config.implementer.provider}/${Date.now()}`;
  console.log(`Branch: ${branch} (from ${previousBranch ?? "HEAD"})`);
  const sandbox = await sandcastle.createSandbox({
    branch,
    baseBranch: previousBranch,
    sandbox: sandboxProvider,
    hooks,
    copyToWorktree,
  });

  const base = previousBranch ?? startCommit;
  try {
    let implement: Awaited<ReturnType<typeof sandbox.run>>;
    try {
      implement = await sandbox.run({
        name: `implementer:${config.implementer.provider}`,
        maxIterations: 1,
        agent: implementer,
        promptFile: "./.sandcastle/implement-prompt.md",
        idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
      });
    } catch (error) {
      console.error(`\nImplementation failed: ${errorMessage(error)}`);
      // The agent may have committed before failing (e.g. it hung after its last step).
      const commits = branchCommits(base, branch);
      const issue = issueFromCommits(commits);
      if (issue !== undefined) {
        gh(["issue", "comment", String(issue), "--body",
          `Committed on \`${branch}\` (${commits.map(({ sha }) => sha.slice(0, 7)).join(", ")}), but the implement phase didn't finish (${errorMessage(error)}). Not reviewed. Left open: cherry-pick these commits rather than redoing the work.`]);
      }
      console.log(`Stopping. Last reviewed branch: ${previousBranch ?? "none"}`);
      break;
    }

    if (!implement.commits.length) {
      console.log("Implementation agent made no commits. Stopping.");
      break;
    }
    console.log(`\nImplementation complete on ${branch} (${implement.commits.length} commits)`);
    const issue = issueFromCommits(implement.commits);
    // Later iterations fork from here whether or not the review succeeds.
    previousBranch = branch;

    try {
      await sandbox.run({
        name: `reviewer:${config.reviewer.provider}`,
        maxIterations: 1,
        agent: reviewer,
        promptFile: REVIEW_PROMPT_FILE,
        idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
        // Diff against the fork point, not the host branch: iterations chain, so
        // the host branch would show every earlier iteration's changes too.
        promptArgs: { BRANCH: branch, BASE: base, ...reviewDiffArgs(base, branch) },
      });
    } catch (error) {
      console.error(`\nReview failed: ${errorMessage(error)}`);
      if (issue !== undefined) {
        gh(["issue", "comment", String(issue), "--body",
          `Implemented on \`${branch}\`, but the review didn't finish (${errorMessage(error)}). Left open: review it before closing.`]);
      }
      console.log("Stopping: an open, implemented issue would be picked up again.");
      break;
    }
    console.log("\nReview complete.");

    if (issue === undefined) {
      console.warn(`Warning: no "(#N)" in the commit subjects on ${branch}; close its issue by hand.`);
    } else {
      gh(["issue", "close", String(issue), "--comment", `Implemented and reviewed on \`${branch}\` by Sandcastle.`]);
    }
  } finally {
    await sandbox.close();
  }
}

console.log(previousBranch ? `\nAll done. Latest branch: ${previousBranch}` : "\nAll done.");
