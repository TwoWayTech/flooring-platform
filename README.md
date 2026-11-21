# Flooring Platform

A multi-company platform for US businesses: the Flooring Suite, plus an HR Suite served on its own host. One codebase, one control database and one PostgreSQL database per company.

`main` is the real product. The clickable demo lives on branch `demo` (tag `demo-v3`); to run, test or deploy it, see [README.demo.md](README.demo.md) and [docs/deploy.md](docs/deploy.md).

## Get started
Prerequisites: Node 22 or newer, pnpm 10 (`corepack enable`), Docker Desktop.

```sh
pnpm install
docker compose up -d   # PostgreSQL 16 on localhost:5432
pnpm db:seed           # control database + Summit Floor Co.; locally also Harbor Staffing Co. (HR Suite) and a platform admin
pnpm dev:api           # API on http://localhost:4000 (health: /health, docs: /docs)
pnpm dev               # web on http://localhost:3000 (demo mode by default)
```

Environment variables are listed in [docs/environment.md](docs/environment.md). Without a `.env`, the database scripts use the local docker-compose server.

## Where things are
| Path | What |
| --- | --- |
| `apps/web` | Next.js app for both products. `NEXT_PUBLIC_DATA_SOURCE=demo` runs on DemoStore, `api` on apps/api module by module |
| `apps/api` | NestJS API |
| `packages/db` | Drizzle schemas (`control`, `company`), migrations, seed |
| `packages/providers` | Database provisioning, file storage and email adapters |
| `packages/shared` | Business rules shared by web and API: permissions, units, money, tax, types |
| `packages/ui` | UI components and tokens |
| `docs/real-build-plan.md` | Module order and the week-by-week plan |
| `docs/product-spec/` | One spec per module |

## Working on it
Two people, one feature branch per task, pull requests into `main`. Start every Claude Code session with `/resume` and end it with `/handoff`. The rules are in [CLAUDE.md](CLAUDE.md).

Client files (sanitized spreadsheets, logos) live in the shared drive folder, never in the repository: _link to be added by the owner_.
