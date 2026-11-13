import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hasSessionLog, localDateStamp, reminderFor } from "./handoff-reminder.mjs";

describe("reminderFor", () => {
  it("is silent when the tree is clean and today's log exists", () => {
    assert.equal(reminderFor({ dirty: false, hasTodayLog: true }), null);
  });

  it("reminds about uncommitted changes", () => {
    const message = reminderFor({ dirty: true, hasTodayLog: true });
    assert.match(message, /run \/handoff/);
    assert.match(message, /uncommitted changes/);
    assert.doesNotMatch(message, /session log/);
  });

  it("reminds about a missing session log", () => {
    const message = reminderFor({ dirty: false, hasTodayLog: false });
    assert.match(message, /session log/);
    assert.doesNotMatch(message, /uncommitted/);
  });

  it("names both reasons when both apply", () => {
    const message = reminderFor({ dirty: true, hasTodayLog: false });
    assert.match(message, /uncommitted changes and today's session log/);
  });
});

describe("localDateStamp", () => {
  it("pads month and day", () => {
    assert.equal(localDateStamp(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  });
});

describe("the hook against a real repo", () => {
  const repo = mkdtempSync(join(tmpdir(), "handoff-hook-"));
  const hook = fileURLToPath(new URL("./handoff-reminder.mjs", import.meta.url));
  const today = localDateStamp(new Date());
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  const runHook = () =>
    execFileSync(process.execPath, [hook], { input: JSON.stringify({ cwd: repo }), encoding: "utf8" });

  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(repo, "docs", "sessions"), { recursive: true });

  after(() => rmSync(repo, { recursive: true, force: true }));

  it("finds only logs named for the given day", () => {
    writeFileSync(join(repo, "docs", "sessions", "2020-01-01-0900-a-old.md"), "old");
    assert.equal(hasSessionLog(repo, today), false);
    assert.equal(hasSessionLog(repo, "2020-01-01"), true);
  });

  it("prints a non-blocking systemMessage when the tree is dirty and the log is missing", () => {
    const output = JSON.parse(runHook());
    assert.deepEqual(Object.keys(output), ["systemMessage"]);
    assert.match(output.systemMessage, /uncommitted changes and today's session log/);
  });

  it("prints nothing once today's log is committed", () => {
    writeFileSync(join(repo, "docs", "sessions", `${today}-1200-a-test.md`), "log");
    git("add", ".");
    git("commit", "-q", "-m", "log");
    assert.equal(runHook(), "");
  });
});
