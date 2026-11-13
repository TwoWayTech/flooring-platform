#!/usr/bin/env node
/**
 * PreToolUse guard for Bash (CLAUDE.md "Every session": squash-merge only, never push to main).
 *
 * Wildcard permission rules cannot say "only these arguments", so this hook reads the whole
 * command and blocks, whatever the permission mode:
 * - any `gh pr merge` unless the whole command is exactly
 *   `gh pr merge <n> --squash [--match-head-commit <sha>] [--delete-branch]`;
 * - any `gh api` call that names a pull request merge or a branch protection or ruleset change;
 * - any `git push` that names `main` as a target, and any force or mirror push.
 * It looks for these words anywhere in the command, so wrappers such as `pnpm exec`, `npx` or
 * `node -e` are caught too (PR #10 security review). It cannot see through deliberately split
 * words; GitHub's own settings are the backstop (docs/STATUS.md).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The only merge command allowed. */
const SQUASH_MERGE =
  /^gh pr merge \d+ --squash( --match-head-commit [0-9a-f]{7,40})?( --delete-branch)?( --match-head-commit [0-9a-f]{7,40})?$/;

/** A push target that is main: `main`, `HEAD:main`, `x:main`, `refs/heads/main`, `+main`. */
const PUSH_TO_MAIN = /(^|[\s:+'"])(refs\/heads\/)?main(?=$|[\s'"])/;

/**
 * Why the command is refused, or null when it may run.
 * @param {string} command the Bash command as Claude would run it
 * @param {string} [branch] the checked-out branch, for a push that names no target
 * @returns {string | null}
 */
export function refusal(command, branch = "") {
  const text = command.trim();
  if (/gh\s+pr\s+merge/.test(text) && !SQUASH_MERGE.test(text)) {
    return "Only `gh pr merge <n> --squash [--match-head-commit <sha>] [--delete-branch]`, run as its own command, is allowed (CLAUDE.md self-merge rule).";
  }
  if (/gh\s+api\b/.test(text) && /pulls\/[^\s]*\/merge|\/protection|\/rulesets|-X\s*(PUT|PATCH|DELETE)[^|;&]*\/repos\/[^\s]+\/(branches|rulesets)/i.test(text)) {
    return "Merging, or changing branch protection or rulesets, through `gh api` is not allowed (CLAUDE.md).";
  }
  for (const push of text.match(/git\s+push\b[^;&|]*/g) ?? []) {
    if (/\s(--force\b|-f\b|--force-with-lease\b|--mirror\b|--all\b|--delete\b|-d\b)/.test(push)) {
      return "Force, mirror, all-branch and delete pushes are not allowed (CLAUDE.md).";
    }
    const args = push.replace(/^git\s+push/, "");
    const targets = args.split(/\s+/).filter((word) => word && !word.startsWith("-"));
    if (PUSH_TO_MAIN.test(args) || (targets.length < 2 && branch === "main")) {
      return "Never push to main; changes reach main only through a squash-merged pull request (CLAUDE.md).";
    }
  }
  return null;
}

/** The checked-out branch, or "" when it cannot be read. */
function currentBranch() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return;
  }
  const command = input?.tool_input?.command;
  if (input?.tool_name !== "Bash" || typeof command !== "string") return;
  const reason = refusal(command, currentBranch());
  if (reason) {
    process.stderr.write(`Blocked by .claude/hooks/merge-push-guard.mjs: ${reason}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
