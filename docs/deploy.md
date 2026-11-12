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
- Not done, left to the owner: the GitHub repository is not connected, because the Vercel GitHub app has no access to `TwoWayTech/flooring-platform`. After granting it access, `vercel git connect` makes every push deploy automatically.

## Later deploys
`vercel deploy --prod` from the repository root. Data lives in each visitor's browser (localStorage), so a deploy never loses anyone's demo changes and needs no database.

## Demo branch (from 2026-11-12)
`main` is now the real product. The demo lives on branch `demo`, created from tag `demo-v3` (commit `e082445`) and pushed to GitHub. Demo fixes go to `demo` (branch from it, pull request into it); nothing from `main` is merged into it.

**Vercel setting that makes production deploy from `demo`:** Project `flooring-demo-twowaytech` → **Settings** → **Environments** → **Production** → **Branch Tracking**: change the branch to `demo` and click **Save**. This applies once the project is connected to Git (give the Vercel GitHub app access to `TwoWayTech/flooring-platform`, then `vercel git connect`).

Recommended with it: **Settings** → **Build and Deployment** → **Ignored Build Step**, choose a custom command and enter `[ "$VERCEL_GIT_COMMIT_REF" != "demo" ]`. That exits 0 (skip the build) for every branch except `demo`, so real-product pushes do not use the demo project's build minutes.

Until Git is connected, deploy by hand from the branch: `git switch demo && vercel deploy --prod`, then `git switch main`.
