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
 * - any `git ... push` that does not name its remote and a `feat/*` or `fix/*` destination
 *   explicitly (an allow-list, so a branch switch earlier in the same command cannot turn a bare
 *   push into a push to main), and any force, mirror, prune or delete push;
 * - `git config` writes that steer pushes (`remote.*.push`, `push.default`, `branch.*.merge`).
 * Words are found anywhere in a segment, so wrappers such as `pnpm exec`, `npx` or `node -e` are
 * caught. A command it cannot read is blocked (fail closed). It cannot see through deliberately
 * split words; GitHub's own settings are the backstop (docs/STATUS.md). PR #10 security reviews.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The only merge command allowed. */
const SQUASH_MERGE =
  /^gh pr merge \d+ --squash( --match-head-commit [0-9a-f]{7,40})?( --delete-branch)?( --match-head-commit [0-9a-f]{7,40})?$/;

/** A segment that runs git and pushes; everything after `push` is checked, whatever options come first. */
const GIT_PUSH = /\bgit\b.*?\bpush\b(.*)$/;

/** The only branches a push may update: work branches (CLAUDE.md, one task per branch). */
const WORK_BRANCH = /^(feat|fix)\/[\w./-]+$/;

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
    // Shell redirections such as `2>&1` or `>/dev/null` are not push arguments.
    .filter((word) => word && !/^\d*[<>]/.test(word));
}

/** Why a push is refused, or null. */
function pushRefusal(args) {
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
  const destinations = refspecs.map((spec) => spec.split(":").at(-1)?.replace(/^refs\/heads\//, "") ?? "");
  if (refspecs.length === 0 || !destinations.every((destination) => WORK_BRANCH.test(destination))) {
    return "Push only to a named work branch: `git push [-q] [-u] origin feat/<name>` or `fix/<name>`. Never push to main (CLAUDE.md).";
  }
  return null;
}

/**
 * Why the command is refused, or null when it may run.
 * @param {string} command the Bash command as Claude would run it
 * @returns {string | null}
 */
export function refusal(command) {
  const text = command.trim();
  const merges = segments(text).some((part) => /\bgh\b.*\bpr\b.*\bmerge\b/.test(part));
  if ((merges || /gh\s+pr\s+merge/.test(text)) && !SQUASH_MERGE.test(text)) {
    return "Only `gh pr merge <n> --squash [--match-head-commit <sha>] [--delete-branch]`, run as its own command, is allowed (CLAUDE.md self-merge rule).";
  }
  for (const part of segments(text)) {
    if (/\bgh\s+repo\s+edit\b/.test(part)) return "`gh repo edit` is not allowed: repository settings are the owner's.";
    if (/\bgh\s+api\b/.test(part)) {
      const writes =
        /\bgraphql\b/.test(part) ||
        /(-X|--method)[\s=]*(?!GET\b)[A-Za-z]+/.test(part) ||
        /(^|\s)(-[fF]\S*|--field\b|--raw-field\b|--input\b)/.test(part);
      if (writes) return "Only read-only `gh api` calls (GET, no fields, no GraphQL) are allowed (CLAUDE.md).";
    }
    if (PUSH_CONFIG.test(part)) return "Changing where git pushes go is not allowed (CLAUDE.md).";
    const push = GIT_PUSH.exec(part);
    if (push) {
      const reason = pushRefusal(push[1]);
      if (reason) return reason;
    }
  }
  return null;
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
  // The PowerShell tool runs commands too, so it gets the same checks (PR #10 review).
  if (input?.tool_name !== "Bash" && input?.tool_name !== "PowerShell") return;
  const command = input?.tool_input?.command;
  if (typeof command !== "string") block("the Bash command could not be read, so it is refused.");
  const reason = refusal(command);
  if (reason) block(reason);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch {
    block("the guard failed, so the command is refused.");
  }
}
