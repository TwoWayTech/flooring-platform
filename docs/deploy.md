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
4. Set the session signing key (recommended). Run `vercel env add DEMO_SESSION_SECRET production` and paste any long random string when asked. Without it the demo still runs, signed with the labelled non-secret key described in ADR 0001; the cookie only records which persona was picked and protects no real data.
5. Deploy to production: `vercel deploy --prod`. `.vercelignore` keeps local builds and caches (such as `.turbo` and `.next`) out of the upload; without it the upload hits the 100 MB file limit.
6. Add the HR hostname to the same project: `vercel domains add hr-demo-twowaytech.vercel.app flooring-demo-twowaytech`.
7. Check both hosts: `https://flooring-demo-twowaytech.vercel.app/login` shows "Flooring Suite" and `https://hr-demo-twowaytech.vercel.app/login` shows "HR Suite". To run the end-to-end checks against the deployment: `E2E_BASE_URL=https://flooring-demo-twowaytech.vercel.app pnpm --filter web test:e2e -- login shell dashboard`.

## Later deploys
`vercel deploy --prod` from the repository root. Data lives in each visitor's browser (localStorage), so a deploy never loses anyone's demo changes and needs no database.
