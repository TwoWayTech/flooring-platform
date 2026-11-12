# 2026-11-12, Person A: Claude tooling (task "c", taken over from B)

## Goal
Build the Claude Code setup from blueprint p35 and p41 that P1 left out:
- the `/feature` and `/review` commands;
- the security-reviewer, test-writer and schema-reviewer subagents;
- the Stop hook.

A took this task over from B. B's job tonight is reviewing and merging PR #2 and this PR.

## Prompt used
"I'm taking task c instead of B. Create feat/tooling-claude-agents from main and build the /feature and /review commands, the three subagents (security-reviewer, test-writer, schema-reviewer) and the Stop hook from the blueprint. Give simple subagents a cheaper model in their frontmatter (schema-reviewer and test-writer on sonnet; security-reviewer stays on opus). Plan mode first. When done, open a PR, make it ready, watch the checks, and tell me when they're green. Don't merge. Update STATUS and BRANCHES so B knows task c is mine and his job tonight is reviewing PR #2 and this PR."

Plan mode was used, and the owner approved the plan.

## Branch and PR
`feat/tooling-claude-agents`, from `main` at `12be45b`. The PR is #3.

## Files changed
- **`.claude/commands/feature.md` (new):** the build loop: branch, read spec, plan, tests first (with test-writer), code against the non-negotiable rules, specialist reviews, docs, checks and summary. It points to `/feature-change` for feature switches.
- **`.claude/commands/review.md` (new):** a read-only pre-PR review against the 15 rules, the Style section, tests, docs and process. It calls the specialists and groups findings as blocking, should-fix and notes.
- **`.claude/agents/security-reviewer.md` (new):** `model: opus`, read-only tools.
- **`.claude/agents/schema-reviewer.md` (new):** `model: sonnet`, read-only tools.
- **`.claude/agents/test-writer.md` (new):** `model: sonnet`. It may write test files only.
- **`.claude/hooks/handoff-reminder.mjs` and `.test.mjs` (new):** the Stop hook and its `node:test` tests.
- **`.claude/settings.json`:** the `hooks.Stop` entry. Permissions are unchanged.
- **`package.json`:** `test:hooks`, chained into `test` so CI runs it.
- **CLAUDE.md, Workflow:** one line on the commands, subagents and hook.
- **docs/STATUS.md and docs/BRANCHES.md:** both taken from PR #2's newer copies, plus this task.

## Decisions and why
- **The Stop hook does not block.** It prints a `systemMessage` that you see, and always exits 0. The tree is dirty for most of a task, so a blocking hook would push Claude into a handoff at the end of every turn. It is silent outside a git checkout.
- **The hook runs in Node.** It is plain Node with no dependencies, so it behaves the same under PowerShell, Git Bash and CI Linux. It is tested with `node:test`, so no new dependency is needed. The tests include a real throwaway git repo.
- **The reviewers are read-only.** The security and schema reviewers get Bash for `git diff` and searches, and their prompts forbid writes. Test-writer may write test files only, and never product code.
- **Models.** security-reviewer is on opus. test-writer and schema-reviewer are on sonnet, as the owner asked.
- **The PostToolUse lint and typecheck hook from p41 is left out.** It was not asked for, and it is recorded in STATUS as a follow-up.
- **No ADR,** because there is no new library.

## Commands run and results
- `pnpm test:hooks`: 8 of 8 pass.
- Running the hook by hand on this repo printed the dirty-tree reminder with exit code 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`: see the PR's "Checks run".
- CI on the PR: see the PR.

## What is left
- B reviews and merges #2, then #3. If STATUS.md or BRANCHES.md conflict once #2 is merged, A rebases #3.
- Optional: the PostToolUse lint and typecheck hook.

## Next prompt
"/resume, then run blueprint prompt P8 part 2 with /feature on feat/auth-mfa (after PR #2 is merged): TOTP with backup codes, passkeys, mandatory MFA for Owner, Accountant, HR and platform admins, rate limits and lockout (ask me for the thresholds), and GET /public/branding?host=; plan mode first."
