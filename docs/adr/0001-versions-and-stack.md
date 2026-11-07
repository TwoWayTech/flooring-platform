# ADR 0001: Versions and stack pins (Phase 0)

Date: 2026-11-07. Status: accepted.

## Context
Phase 0 checked the latest published versions on npm and the current APIs with Context7 (Next.js 16.2 docs, shadcn 4.21 docs, Motion 14.9, TanStack Table main).

## Decisions

| Package | Pinned | Why |
| --- | --- | --- |
| next | 16.4.5 | Latest stable. Uses `proxy.ts` with `export function proxy()` (renamed from middleware in v16). |
| react, react-dom | 19.3.1 | Latest; satisfies Next's `^19.0.0` peer range. |
| typescript | 5.9.3 | TypeScript 7.0 (native port) is `latest`, but Next's build-time type check and typescript-eslint depend on the JS compiler API, which 7.0 does not ship as a stable API yet. 5.9 is the newest line with full tool support. Revisit when Next documents TS 7. |
| tailwindcss | 4.3.5 | CSS-first config (`@import "tailwindcss"`, `@theme inline`), no tailwind.config file. |
| shadcn (CLI) | 4.23.0 | Monorepo layout from the shadcn docs: `components.json` in `apps/web` and `packages/ui`, Tailwind config left empty. We pick the **Radix** base (`style: radix-nova`) instead of the new Base UI default: Radix's `asChild` API is mature and well known, which lowers risk for a solo build. |
| motion | 14.10.1 | Import from `motion/react`. `MotionConfig reducedMotion="user"` at the root. |
| @tanstack/react-table | 8.21.3 | v9 is the npm latest but replaces `useReactTable` with an explicit `tableFeatures` + `useTable` API. v8 is mature and fully documented; the v8 → v9 codemod path exists for the real build. |
| recharts | 3.x | Used through shadcn chart components. |
| zod / react-hook-form | 4.x / 7.x | Forms. |
| decimal.js | 10.6 | All money math. |
| @faker-js/faker | 10.x | Fixed seed fixture generator. |
| jose | 6.x | Signs the demo session cookie (HS256). |
| vitest / @playwright/test | 5.1 / 1.65 | Unit and e2e tests. |
| turbo | 2.11 | Task runner. |

## Session cookie key
The demo cookie only records which persona the presenter picked; it protects no real data. It is signed with `DEMO_SESSION_SECRET` when that environment variable is set (set it on Vercel), and otherwise with a non-secret, clearly labelled local key so the demo runs with zero setup. No secret is committed.
