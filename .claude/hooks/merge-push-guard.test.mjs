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

test("refuses every other merge, however it is wrapped (PR #10 security reviews)", () => {
  for (const bad of [
    "gh pr merge 10 -r",
    "gh pr merge 10 --rebase",
    "gh pr merge 10 --squash=false -r",
    "gh pr merge 10 --squash --match-head-commit abc1234 -s=false -r --delete-branch",
    "gh pr merge 10 -r --body --squash",
    "gh pr merge 10 -r -t --squash",
    "gh pr merge 10 --squash --admin",
    "gh pr merge 10 --squash --auto",
    "gh pr merge 10 --merge",
    "pnpm exec gh pr merge 10 --rebase --admin",
    "npx gh pr merge 10 --squash",
    "node -e \"require('child_process').execSync('gh pr merge 10 --admin --merge')\"",
    "gh pr merge 10 --squash && git branch -r",
    "gh pr -R TwoWayTech/flooring-platform merge 10 --merge --admin",
  ]) {
    assert.notEqual(refusal(bad), null, bad);
  }
});

test("allows only read-only gh api calls and no repository edits", () => {
  for (const bad of [
    "gh api -X PUT repos/o/r/pulls/10/merge -f merge_method=rebase",
    "gh api -X DELETE repos/o/r/branches/main/protection",
    "gh api graphql -f query='mutation{mergePullRequest(input:{pullRequestId:\"x\",mergeMethod:REBASE}){clientMutationId}}'",
    "gh api repos/o/r/merges -f base=main -f head=feat/x",
    "gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc -F force=true",
    "gh api --method=POST repos/o/r/pulls",
    "gh api repos/o/r/pulls --input body.json",
    "gh repo edit --enable-rebase-merge",
    "gh api repos/o/r/merges -fbase=main -fhead=fix/x",
    "gh api repos/o/r/git/refs/heads/main -Fforce=true",
  ]) {
    assert.notEqual(refusal(bad), null, bad);
  }
  for (const ok of [
    "gh api repos/o/r --jq '{rebase:.allow_rebase_merge}'",
    "gh api -X GET repos/o/r/pulls/10",
    "gh api repos/o/r/pulls/10/comments",
  ]) {
    assert.equal(refusal(ok), null, ok);
  }
});

test("refuses pushes to main, pushes of HEAD from main, steered and forced pushes", () => {
  for (const bad of [
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin HEAD:refs/heads/main",
    "git push origin feat/x:main",
    "git push -u origin main",
    "git push origin +main",
    "git push origin +feat/x",
    "git push -uf origin feat/x",
    "git push --force origin feat/x",
    "git push --force-with-lease origin feat/x",
    "git push origin --delete feat/x",
    "git push origin :feat/x",
    "git push --mirror",
    "git add . && git push origin main",
    "git -C /c/dev/flooring-platform push origin main",
    "git --no-pager push origin main",
    "git -c push.default=current push origin main",
    "git config remote.origin.push HEAD:main",
    "git config push.default upstream",
    "git config branch.feat/x.merge refs/heads/main",
    "git switch main && git merge --ff-only fix/x && git push origin",
    "git switch main && git push -q",
    "git push -q",
    "git push origin",
    "git push -u origin HEAD",
    "git push origin @",
    "git --git-dir .git push origin main",
    'git -C "C:/path with space" push origin main',
    "cd /c/dev && git push",
    "git push origin demo",
  ]) {
    assert.notEqual(refusal(bad), null, bad);
  }
  for (const bad of ["git push -q", "git push origin", "git push -u origin HEAD", "git push origin @"]) {
    assert.notEqual(refusal(bad), null, `${bad} on main`);
  }
  for (const ok of [
    "git push origin feat/maintenance-mode",
    "git push -q -u origin fix/platform-owner-decisions",
    "git -C /c/dev/flooring-platform push -q origin feat/x",
    "git push -q -u origin feat/settings-users-roles 2>&1 | tail -1",
    "git push -q origin fix/x >/dev/null 2>&1",
    "git push -q origin HEAD:fix/platform-owner-decisions",
    "git log --oneline main..HEAD",
    "git checkout main && git pull --ff-only",
    "gh pr view 10",
    "git branch -r",
    "git config --get remote.origin.url",
  ]) {
    assert.equal(refusal(ok), null, ok);
  }

});

test("does not read the quoted title or body of a PR or issue call (owner, 2026-11-14)", () => {
  for (const ok of [
    "gh pr review 16 --comment --body 'Merge with gh pr merge 16 --squash; never git push origin main.'",
    "gh pr review 16 --comment -b \"Never gh pr merge 16 --admin | git push origin main\"",
    "gh pr comment 16 --body='gh api -X POST repos/x; git push --force origin main'",
    "gh pr create --draft --title 'chore: git push origin main is refused' --body 'See gh pr merge 1 --rebase'",
    "gh pr edit 16 --body 'It''s fine: git push origin main' --add-label docs",
    "gh issue comment 3 -b 'gh repo edit --enable-rebase-merge'",
    "gh pr create --draft --title 'x' --body-file body.md",
  ]) {
    assert.equal(refusal(ok), null, ok);
  }
});

test("still reads anything that is not a literal title or body", () => {
  for (const bad of [
    // Commands after the body run, so they are checked.
    "gh pr comment 16 --body 'note'; git push origin main",
    "gh pr comment 16 --body 'note' && gh pr merge 16 --rebase",
    "gh pr comment 16 --body \"note\" | git push origin main",
    // Double quotes that could expand or end early are read as shell.
    "gh pr comment 16 --body \"$(git push origin main)\"",
    "gh pr comment 16 --body \"`git push origin main`\"",
    "gh pr comment 16 --body \"a\\\"; git push origin main; echo \\\"\"",
    // The PR call must start the command; a quote opened elsewhere is not a body.
    "echo \"gh pr comment 1 -b '\" ; git push origin main ; echo \"'\"",
    "git push origin main; gh pr comment 1 --body 'x'",
    "bash -c 'gh pr comment 1 -b \"x\"; git push origin main'",
    // Other gh commands are not prose.
    "gh pr merge 16 --rebase --body 'x'",
    "gh api -X POST repos/x/y/pulls/1/reviews -f body='ok'",
  ]) {
    assert.notEqual(refusal(bad), null, bad);
  }
});

test("blocks with exit code 2, fails closed, and ignores other tools", () => {
  const run = (input) =>
    spawnSync(process.execPath, [HOOK], {
      input: typeof input === "string" ? input : JSON.stringify(input),
      encoding: "utf8",
    });
  const blocked = run({ tool_name: "Bash", tool_input: { command: "gh pr merge 10 --rebase" } });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Only `gh pr merge/);
  assert.equal(run({ tool_name: "Bash", tool_input: { command: "pnpm lint" } }).status, 0);
  assert.equal(run({ tool_name: "Read", tool_input: { file_path: "main" } }).status, 0);
  assert.equal(run("not json").status, 2);
  assert.equal(run({ tool_name: "PowerShell", tool_input: { command: "git push origin main" } }).status, 2);
  assert.equal(run({ tool_name: "Bash", tool_input: {} }).status, 2);
});
