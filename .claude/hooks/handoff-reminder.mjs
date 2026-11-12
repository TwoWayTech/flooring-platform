// Stop hook (blueprint p41): reminds the person to run /handoff when today's session log is
// missing or the working tree has uncommitted changes. It never blocks Claude from stopping:
// the tree is dirty during most of a task, so blocking would force a handoff at every turn.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Builds the reminder for the given repo state, or null when nothing is outstanding.
 * @param {{ dirty: boolean, hasTodayLog: boolean }} state
 * @returns {string | null}
 */
export function reminderFor({ dirty, hasTodayLog }) {
  const reasons = [];
  if (dirty) reasons.push("the working tree has uncommitted changes");
  if (!hasTodayLog) reasons.push("today's session log in docs/sessions/ is missing");
  if (reasons.length === 0) return null;
  return `Reminder: run /handoff before you finish — ${reasons.join(" and ")}.`;
}

/**
 * Formats a date as YYYY-MM-DD in local time, the prefix /handoff gives session logs.
 * @param {Date} date
 * @returns {string}
 */
export function localDateStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Tells whether docs/sessions/ holds a log whose name starts with the given date.
 * @param {string} repoRoot
 * @param {string} stamp
 * @returns {boolean}
 */
export function hasSessionLog(repoRoot, stamp) {
  try {
    return readdirSync(join(repoRoot, "docs", "sessions")).some(
      (name) => name.startsWith(`${stamp}-`) && name.endsWith(".md"),
    );
  } catch {
    return false;
  }
}

/** Reads the hook input Claude Code sends on stdin; an empty object when there is none. */
function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function main() {
  const input = readHookInput();
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let repoRoot;
  let dirty;
  try {
    repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
    dirty = git(["status", "--porcelain"]).trim().length > 0;
  } catch {
    return; // Not a git checkout, or git is missing: stay silent rather than nag.
  }
  const hasTodayLog = hasSessionLog(repoRoot, localDateStamp(new Date()));
  const message = reminderFor({ dirty, hasTodayLog });
  if (message) process.stdout.write(JSON.stringify({ systemMessage: message }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
