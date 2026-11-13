#!/usr/bin/env node
/**
 * PreToolUse guard for Bash (CLAUDE.md "Every session": squash-merge only, never push to main).
 *
 * Wildcard permission rules cannot say "only these arguments", so this hook reads the whole
 * command, splits it at `;`, `&&`, `||`, `|` and line breaks, and blocks in every permission mode:
 * - any `gh pr merge` unless the whole command is exactly
 *   `gh pr merge <n> --squash [--match-head-commit <sha>] [--delete-branch]`;
 * - any `gh api` call that is not a plain read (a method other than GET, fields or input, which
 *   make it a POST, or GraphQL), and `gh repo edit`, which could switch merge methods back on;
 * - any `git ... push` (git options such as `-C dir` before `push` included) that names `main`,
 *   pushes HEAD or the current branch while main is checked out, or forces, mirrors or deletes;
 * - `git config` writes that steer pushes (`remote.*.push`, `push.default`, `branch.*.merge`).
 * Words are found anywhere in a segment, so wrappers such as `pnpm exec`, `npx` or `node -e` are
 * caught. A command it cannot read is blocked (fail closed). It cannot see through deliberately
 * split words; GitHub's own settings are the backstop (docs/STATUS.md). PR #10 security reviews.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The only merge command allowed. */
const SQUASH_MERGE =
  /^gh pr merge \d+ --squash( --match-head-commit [0-9a-f]{7,40})?( --delete-branch)?( --match-head-commit [0-9a-f]{7,40})?$/;

/** `git`, then any global options (`-C dir`, `-c key=value`, `--no-pager`, `--git-dir=…`), then `push`. */
const GIT_PUSH = /\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?|-[a-zA-Z]+))*\s+push\b(.*)$/;

/** `git config` writes that would change where a push goes. */
const PUSH_CONFIG = /\bgit\b.*\bconfig\b.*\b(remote\.[^\s.]+\.push|push\.default|branch\.[^\s]+\.merge)\b/;

/** One part of a command line, at `;`, `&&`, `||`, `|` or a line break. */
function segments(command) {
  return command.split(/&&|\|\||[;|\n]/).map((part) => part.trim().replace(/^["']+|["')]+$/g, ""));
}

/** Words of a push's arguments, quotes removed. */
function words(args) {
  return args
    .split(/\s+/)
    .map((word) => word.replace(/^["']+|["')]+$/g, ""))
    .filter(Boolean);
}

/** Why a push is refused, or null. */
function pushRefusal(args, branch) {
  const all = words(args);
  const flags = all.filter((word) => word.startsWith("-"));
  const targets = all.filter((word) => !word.startsWith("-"));
  const forcing = flags.some(
    (flag) =>
      /^--(force|force-with-lease|force-if-includes|mirror|all|delete|prune)\b/.test(flag) ||
      /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(flag),
  );
  if (forcing || targets.some((target) => target.startsWith("+") || target.startsWith(":"))) {
    return "Force, mirror, all-branch, prune and delete pushes are not allowed (CLAUDE.md).";
  }
  const refspecs = targets.slice(1);
  const namesMain = refspecs.some((spec) => /(^|:)(refs\/heads\/)?main$/.test(spec));
  const pushesCurrent = refspecs.length === 0 || refspecs.some((spec) => /^(HEAD|@)$/.test(spec));
  if (namesMain || (branch === "main" && pushesCurrent)) {
    return "Never push to main; changes reach main only through a squash-merged pull request (CLAUDE.md).";
  }
  return null;
}

/**
 * Why the command is refused, or null when it may run.
 * @param {string} command the Bash command as Claude would run it
 * @param {string} [branch] the checked-out branch, for a push that names no branch
 * @returns {string | null}
 */
export function refusal(command, branch = "") {
  const text = command.trim();
  if (/gh\s+pr\s+merge/.test(text) && !SQUASH_MERGE.test(text)) {
    return "Only `gh pr merge <n> --squash [--match-head-commit <sha>] [--delete-branch]`, run as its own command, is allowed (CLAUDE.md self-merge rule).";
  }
  for (const part of segments(text)) {
    if (/\bgh\s+repo\s+edit\b/.test(part)) return "`gh repo edit` is not allowed: repository settings are the owner's.";
    if (/\bgh\s+api\b/.test(part)) {
      const writes =
        /\bgraphql\b/.test(part) ||
        /(-X|--method)[\s=]*(?!GET\b)[A-Za-z]+/.test(part) ||
        /\s(-f|-F|--field|--raw-field|--input)(\s|=)/.test(part);
      if (writes) return "Only read-only `gh api` calls (GET, no fields, no GraphQL) are allowed (CLAUDE.md).";
    }
    if (PUSH_CONFIG.test(part)) return "Changing where git pushes go is not allowed (CLAUDE.md).";
    const push = GIT_PUSH.exec(part);
    if (push) {
      const reason = pushRefusal(push[1], branch);
      if (reason) return reason;
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

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/merge-push-guard.mjs: ${reason}\n`);
  process.exit(2);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    block("the tool call could not be read, so it is refused.");
  }
  if (input?.tool_name !== "Bash") return;
  const command = input?.tool_input?.command;
  if (typeof command !== "string") block("the Bash command could not be read, so it is refused.");
  const reason = refusal(command, currentBranch());
  if (reason) block(reason);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch {
    block("the guard failed, so the command is refused.");
  }
}
