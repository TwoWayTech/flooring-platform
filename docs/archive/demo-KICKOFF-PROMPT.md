# The one prompt

Paste everything inside the box into Claude Code, started in this folder, in auto mode. When it stops (finished phase, usage limit, or a new five-hour window), type `/continue`.

```text
You are building our client demo, solo, in this repo. Read in this order: CLAUDE.md, docs/demo-spec.md,
docs/design-brief.md, docs/STATUS.md. The full blueprint PDF in docs/blueprint/ is reference only; open
it when the spec points to a section.

GOAL: a complete, polished, deployed demo exactly as docs/demo-spec.md describes, with seeded dummy
data, that we can present to a flooring client. Tier 1, then Tier 2, then Tier 3.

HOW TO WORK
1. Do not stop to ask me questions. When something is unclear, make the sensible choice, record it in
   docs/adr/, and keep going. Stop only for something you truly cannot do (a login, a payment, a secret).
2. Phase 0, plan (keep it short): check current versions and APIs of Next.js, Tailwind, shadcn/ui and
   Motion with Context7; expand docs/STATUS.md into concrete tasks per phase; then start building.
3. Phase 1, foundation: monorepo; packages/shared (keys, permission engine, formatNumber, units, money,
   US pack) with unit tests; seeded fixtures generator plus the reconciliation test; DemoStore,
   apiClient, the three demo route handlers and the hostname proxy; packages/ui design system from
   docs/design-brief.md (tokens, fonts, both themes, floor-pattern component, roll gauge); app shell.
   Before writing UI code, write docs/design-plan.md (tokens, wireframes, signature element), check it
   against the brief and its avoid-list, and revise anything that reads generic.
4. Phase 2: Tier 1 screens in spec order. Phase 3: Tier 2. Phase 4: Tier 3 polish.
5. Loop for every screen: build it, run it, take Playwright MCP screenshots in light and dark at 1440 px
   and 390 px, fix anything that looks off against the design brief, add its Playwright test, commit,
   tick STATUS.md.
6. After each phase: run lint, typecheck, unit and e2e tests and fix failures; update STATUS.md; write a
   session log in docs/sessions/; push if a remote exists.
7. Phase 5, ship: production build passes; write docs/demo-script.md (20 to 30 minute click path); deploy
   to Vercel with the CLI using one project and two hostnames (flooring-demo and hr-demo on vercel.app),
   asking me before the deploy command runs; if the CLI is not logged in, write the exact steps for me
   instead. Put the URLs in STATUS.md.

USAGE
Keep context small: use subagents for exploration and long reads, open only the spec sections you need,
and do not re-read files you already have. If usage runs low, finish the current task, commit, update
STATUS.md with the exact next step, write the session log, and stop. When I type /continue, resume from
STATUS.md.

Start with Phase 0 now.
```
