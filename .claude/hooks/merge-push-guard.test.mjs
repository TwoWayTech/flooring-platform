import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { refusal } from "./merge-push-guard.mjs";

const HOOK = fileURLToPath(new URL("./merge-push-guard.mjs", import.meta.url));

test("allows only the exact squash merge", () => {
  for (const ok of [
    "gh pr merge 10 --squash",
    "gh pr merge 10 --squash --delete-branch",
    "gh pr merge 10 --squash --match-head-commit 6fbb478 --delete-branch",
    "gh pr merge 10 --squash --delete-branch --match-head-commit 6fbb47812ab",
  ]) {
    assert.equal(refusal(ok), null, ok);
  }
});

test("refuses every other merge, however it is wrapped (PR #10 security review)", () => {
  for (const bad of [
    "gh pr merge 10 -r",
    "gh pr merge 10 --rebase",
    "gh pr merge 10 --squash=false -r",
    "gh pr merge 10 --squash --match-head-commit abc1234 -s=false -r --delete-branch",
    "gh pr merge 10 -r --body --squash",
    "gh pr merge 10 --squash --admin",
    "gh pr merge 10 --merge",
    "pnpm exec gh pr merge 10 --rebase --admin",
    "npx gh pr merge 10 --squash",
    "node -e \"require('child_process').execSync('gh pr merge 10 --admin --merge')\"",
    "gh pr merge 10 --squash && git branch -r",
    "gh api -X PUT repos/o/r/pulls/10/merge -f merge_method=rebase",
    "gh api -X DELETE repos/o/r/branches/main/protection",
  ]) {
    assert.notEqual(refusal(bad), null, bad);
  }
});

test("refuses pushes to main and force pushes, and allows feature branches", () => {
  for (const bad of [
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin HEAD:refs/heads/main",
    "git push origin feat/x:main",
    "git push -u origin main",
    "git push origin +main",
    "git push --force origin feat/x",
    "git push origin --delete feat/x",
    "git push --mirror",
    "git add . && git push origin main",
  ]) {
    assert.notEqual(refusal(bad), null, bad);
  }
  for (const ok of [
    "git push origin feat/maintenance-mode",
    "git push -q -u origin fix/platform-owner-decisions",
    "git push -q",
    "git log --oneline main..HEAD",
    "gh pr view 10",
    "git branch -r",
  ]) {
    assert.equal(refusal(ok, "feat/x"), null, ok);
  }
  // A push that names no branch pushes the checked-out one.
  assert.notEqual(refusal("git push -q", "main"), null);
  assert.notEqual(refusal("git push origin", "main"), null);
  assert.equal(refusal("git push origin feat/x", "main"), null);
});

test("blocks with exit code 2 as a PreToolUse hook and ignores other tools", () => {
  const run = (input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8" });
  const blocked = run({ tool_name: "Bash", tool_input: { command: "gh pr merge 10 --rebase" } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Only `gh pr merge/);
  assert.equal(run({ tool_name: "Bash", tool_input: { command: "pnpm lint" } }).status, 0);
  assert.equal(run({ tool_name: "Read", tool_input: { file_path: "main" } }).status, 0);
});
