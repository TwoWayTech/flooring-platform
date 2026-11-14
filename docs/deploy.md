# Deploying the demo to Vercel

One Vercel project serves both products. The app picks the product from the hostname: any host starting with `hr-demo` serves the HR Suite, every other host the Flooring Suite (`apps/web/src/lib/product.ts`).

## Hostnames
The spec asks for `flooring-demo.vercel.app` and `hr-demo.vercel.app`. On 2026-11-07 both were already in use by other Vercel accounts (`hr-demo.vercel.app` serves someone else's site; `flooring-demo.vercel.app` answers `NOT_FOUND` from an existing deployment). The demo uses suffixed names instead, which the hostname rule above already handles:

- Flooring Suite: `flooring-demo-twowaytech.vercel.app` (the project's own production domain)
- HR Suite: `hr-demo-twowaytech.vercel.app` (a second domain on the same project)

## Steps (Vercel CLI 65 or newer, Hobby plan)
Run these from the repository root, `C:\dev\flooring-platform`.

1. Check you are signed in: `vercel whoami`. If not, run `vercel login` and follow the browser prompt.
2. Create and link the project: `vercel link --yes --project flooring-demo-twowaytech`. This writes `.vercel/` (git-ignored).
3. Point the project at the app inside the monorepo. In the Vercel dashboard, open the project, then Settings, Build and Deployment: set **Root Directory** to `apps/web`, keep **Include files outside the root directory** on, and check that the framework shows **Next.js**. Install and build commands stay on their defaults (pnpm is detected from `pnpm-lock.yaml`).
4. Set the session signing key (recommended). Pipe a random value straight in, so it is never shown or saved: `node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))" | vercel env add DEMO_SESSION_SECRET --environment production --sensitive --yes`. Deploy afterwards (step 5) for it to take effect. Without it the demo still runs, signed with the labelled non-secret key described in ADR 0001; the cookie only records which persona was picked and protects no real data. Changing the key signs everyone out once; their demo data stays in their browser.
5. Deploy to production: `vercel deploy --prod`. `.vercelignore` keeps local builds and caches (such as `.turbo` and `.next`) out of the upload; without it the upload hits the 100 MB file limit.
6. Add the HR hostname to the same project: `vercel domains add hr-demo-twowaytech.vercel.app flooring-demo-twowaytech`.
7. Check both hosts: `https://flooring-demo-twowaytech.vercel.app/login` shows "Flooring Suite" and `https://hr-demo-twowaytech.vercel.app/login` shows "HR Suite".
8. Run the end-to-end checks against the deployment. Each product is its own Playwright project with its own address: `E2E_FLOORING_URL=https://flooring-demo-twowaytech.vercel.app E2E_HR_URL=https://hr-demo-twowaytech.vercel.app pnpm test:e2e`. Remote runs retry twice and wait longer, so a slow connection does not fail them. HR Suite tests (tagged `@hr`) run on the HR address and sign in to Harbor Staffing.

## Current deployment (2026-11-11)
- Project `flooring-demo-twowaytech` (personal scope `twowaytech`), Root Directory `apps/web`, Next.js, Node 24. Both hostnames are assigned and live.
- Production runs commit `e082445`, tagged `demo-v3` (deployment `dpl_28kmeYnUrHAmzt1vmdPvrgnNzvCX`). Both hostnames point at it. It differs from the 2026-11-10 deploy of `439943a` only by one test, these records and the signing key.
- `DEMO_SESSION_SECRET` is set for Production as a Sensitive variable (step 4), a random 48-byte value that was never printed or saved.
- Checked on 2026-11-11 after that deploy: `login.spec.ts` against both live addresses passed, 14 of 14 (every Summit persona on the Flooring host, three Harbor personas on the HR host, a wrong code, sign out, phone layout). A cookie signed with the old non-secret key is refused on both hosts (sent to `/login`), while a local build without the variable still accepts it.
- The full suite last ran against the 2026-11-10 deploy, with one worker in eight chunks: 469 tests, 461 passed, 7 skipped as switched off, 1 failed. The failure was a test still looking for a renamed presenter guide step; it was corrected and passed against the live site on its own.
- Since 2026-11-12 the repository is connected to Vercel and production deploys from branch `demo` (see "Demo branch" below).

## Later deploys
Merge into `demo` (through a pull request into it) and Vercel builds and promotes it to production. `vercel deploy --prod` from a `demo` checkout still works as a manual fallback. Data lives in each visitor's browser (localStorage), so a deploy never loses anyone's demo changes and needs no database.

## Demo branch (from 2026-11-12)
`main` is now the real product. The demo lives on branch `demo`, created from tag `demo-v3` (commit `e082445`) and pushed to GitHub. Demo fixes go to `demo` (branch from it, pull request into it); nothing from `main` is merged into it.

**Vercel setting that makes production deploy from `demo`:** Project `flooring-demo-twowaytech` → **Settings** → **Environments** → **Production** → **Branch Tracking**: change the branch to `demo` and click **Save**. This applies once the project is connected to Git (give the Vercel GitHub app access to `TwoWayTech/flooring-platform`, then `vercel git connect`).

Recommended with it: **Settings** → **Build and Deployment** → **Ignored Build Step**, choose a custom command and enter `[ "$VERCEL_GIT_COMMIT_REF" != "demo" ]`. That exits 0 (skip the build) for every branch except `demo`, so real-product pushes do not use the demo project's build minutes.

**Done by the owner on 2026-11-12:**
- The Vercel GitHub app has access to `TwoWayTech/flooring-platform`, and the project is connected to the repository.
- Production Branch Tracking is set to `demo`.
- The Ignored Build Step is set, so pushes to `main` and feature branches do not build the demo.
- The first Git deploy from `demo` (commit `2026f30`, "chore: trigger first demo deploy from Git") is live and marked Current.

**Only `demo` deploys (owner, 2026-11-14).**
- `apps/web/vercel.json` sets `git.deploymentEnabled` to `{"**": false, "demo": true}`. Vercel reads `vercel.json` from the project's Root Directory, which is `apps/web`.
- `**` (minimatch) also matches branch names with a slash, such as `feat/x`. A branch that matches several rules deploys when any of them is true, so `demo` still deploys.
- Every branch made from `main` carries the file, so Vercel creates no deployment and spends no build quota on it. `demo` does not carry the file, and Vercel deploys a branch by default, so `demo` keeps deploying.
- The Ignored Build Step stays as a second guard.
- On pull requests into `main`, Vercel's status is ignored: the self-merge rule counts only the GitHub Actions checks (CLAUDE.md). This followed the Free plan's "Deployment rate limited" error on PR #16's preview.
