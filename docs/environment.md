# Environment variables

Every variable the apps read, with the local default. Put real values in a local `.env` or `.env.local` at the repository root (never committed; the API and db scripts load both, `.env.local` winning) or the host's settings. Claude Code is denied access to `.env` files, so this page is the list of names. The API validates its variables at start-up (`apps/api/src/core/config/env.ts`) and refuses to start when one is wrong.

| Variable | Used by | Local value | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_DATA_SOURCE` | web | `demo` | `demo` runs on DemoStore with no backend. `api` sends the methods listed in `API_METHODS` to apps/api |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` | Base URL of apps/api, used only when the data source is `api`. The browser never calls it directly: the web app proxies `/api/auth/*` and `/api-proxy/*` to it, so the session cookie stays on the web host |
| `DEMO_SESSION_SECRET` | web | empty | Demo mode only; see `docs/deploy.md` |
| `API_PORT` | api | `4000` | |
| `CORS_ORIGINS` | api | `http://localhost:3000` | Comma-separated web origins allowed to call the API with cookies |
| `CONTROL_DATABASE_URL` | api, db scripts | `postgres://postgres:postgres@localhost:5432/control` | The control database |
| `TENANT_DB_ADMIN_URL` | db scripts | `postgres://postgres:postgres@localhost:5432/postgres` | A superuser login on the server that holds company databases (`DB_PROVIDER=postgres`) |
| `CONNECTION_ENCRYPTION_KEY` | api, db scripts | generate one | 32 random bytes in base64: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Encrypts company connection strings with AES-256-GCM |
| `DB_PROVIDER` | api, db scripts | `postgres` | `neon`, `postgres` or `noop` |
| `NEON_API_KEY`, `NEON_REGION` | `DB_PROVIDER=neon` | empty, `aws-us-east-2` | Region must be a US region |
| `STORAGE_PROVIDER` | api | `memory` | `r2`, `s3` or `memory` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `STORAGE_PROVIDER=r2` or `s3` | empty | For R2, `S3_ENDPOINT` is `https://<account>.r2.cloudflarestorage.com` and `S3_REGION` is `auto` |
| `BETTER_AUTH_SECRET` | api | generate one | Signs session cookies and tokens; at least 32 characters: `npx auth secret`. Changing it signs everyone out |
| `AUTH_ALLOWED_HOSTS` | api | `localhost:*` outside production | Comma-separated web hosts that serve sign-in. Verification links and origin checks use them (ADR 0029). In production it is required and must list exact hosts: the API refuses to start with a wildcard, because the forwarded host is trusted and a shared wildcard such as `*.vercel.app` would let another site receive our links |
| `SEED_USER_PASSWORD` | db scripts | empty | Password `pnpm db:seed` gives every seeded user, at least 12 characters. Unset: the seeded users get no password. Only new credentials get it; it never changes an existing one |
| `E2E_USER_PASSWORD` | web api-mode e2e | `SEED_USER_PASSWORD` | Password the api-mode Playwright tests sign in with |
| `EMAIL_PROVIDER` | api | `memory` | `resend` or `memory`. `memory` sends nothing (locally, verification links stay in the API's memory) |
| `RESEND_API_KEY`, `EMAIL_FROM` | `EMAIL_PROVIDER=resend` | empty | `EMAIL_FROM` must be on a verified domain |

CI sets the database variables and a throwaway encryption key in `.github/workflows/ci.yml`; they protect nothing. The `verify` job also makes a fresh `SEED_USER_PASSWORD` and `BETTER_AUTH_SECRET` for each run, masked in the log.
