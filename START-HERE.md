# Start here: build the demo with one prompt

Do steps 1 to 6 once, by hand. Step 7 is the only prompt. Step 8 is what to do when Claude pauses.

## 1. Put the folder in the right place (Windows)

- Create `C:\dev\` and unzip this kit there, so you have `C:\dev\flooring-platform\`.
- Keep it out of OneDrive, Desktop and Documents: syncing `node_modules` makes everything slow.
- The blueprint PDF is already in `docs\blueprint\`.

## 2. Install the tools (PowerShell, once)

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
winget install GitHub.cli
winget install Microsoft.VisualStudioCode
winget install Anthropic.ClaudeCode
```

Close PowerShell, open a new window, then:

```powershell
npm install -g pnpm vercel
git --version
node --version
pnpm --version
claude --version
```

If `winget install Anthropic.ClaudeCode` fails, use `irm https://claude.ai/install.ps1 | iex` instead. Claude installs the project's own packages and the Playwright browser itself during the build.

## 3. Sign in to the accounts (only you can do this)

```powershell
gh auth login
vercel login
```

- GitHub: Claude will push the code there. Vercel (free Hobby plan): Claude deploys the demo at the end. Hobby is for non-commercial use; Netlify Free is the fallback if you prefer (see the blueprint).
- Claude: you sign in with the $100 account the first time you run `claude` (step 6).

## 4. Start the repository

```powershell
cd C:\dev\flooring-platform
git init -b main
git add .
git commit -m "chore: starter kit"
gh repo create flooring-platform --private --source . --push
```

## 5. Add the plugins and the browser tool

Inside Claude Code (run `claude` in the folder, sign in, then type):

```text
/plugin install frontend-design@claude-plugins-official
/plugin install context7@claude-plugins-official
/reload-plugins
```

Exit Claude (`/exit`), then in PowerShell add the Playwright browser tool:

```powershell
claude mcp add playwright -- cmd /c npx @playwright/mcp@latest
```

On macOS, Linux or WSL use `claude mcp add playwright -- npx @playwright/mcp@latest`. Start `claude` again and type `/mcp` to check that playwright and context7 are connected. If a plugin is not found by name, type `/plugin` and pick it from the official marketplace.

What each one does:
- frontend-design: makes Claude's UI choices distinctive instead of templated.
- context7: current documentation for Next.js, Tailwind, shadcn/ui and Motion, so code matches today's versions.
- playwright: Claude opens the demo in a real browser, takes screenshots and fixes what it sees.

## 6. Set up the session

- Start `claude` in `C:\dev\flooring-platform`.
- Type `/model` and choose a Sonnet model for the long build; it stretches the $100 plan much further than Opus.
- Press Shift+Tab until the footer shows auto mode (or start with `claude --permission-mode auto`). Auto mode lets Claude work without stopping for routine approvals, while still blocking risky actions.
- If Claude asks to trust the folder or its settings, approve.

## 7. Run the one prompt

Open `KICKOFF-PROMPT.md`, copy everything inside the box, paste it into Claude Code, press Enter.

## 8. When Claude pauses

The $100 plan has a five-hour session limit and a weekly limit. A demo this size will usually need more than one five-hour window. When Claude stops, or after the limit resets, start `claude` in the same folder and type:

```text
/continue
```

Everything it needs is written in `docs/STATUS.md` and `docs/sessions/`, so nothing is lost, even after a power cut. To end a session yourself at any point, type `/handoff`.

## What you get at the end

- The demo deployed on Vercel: a Flooring host and an HR host (or exact deploy steps if a login was missing).
- `docs/demo-script.md`: the click path to present it to the client.
- Tests passing and every step logged in the repo.
