# tax-docs

Local repository for tax documents and related files, with a Ramp-inspired design system and a Bun + TypeScript full-stack prototype foundation.

## Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **API:** Hono (`src/server/`)
- **Database:** MongoDB (NoSQL) — in-memory for zero-setup dev, Docker for persistent local data
- **Client:** Vite + TypeScript (`src/client/`)
- **Validation:** Zod shared schemas (`src/shared/schemas/`)

## Project structure

```text
design-system/   Design tokens, CSS, and documentation
src/
  server/        Hono API, config, MongoDB access
  client/        Vite frontend entry and styles
  shared/        Zod schemas shared by client and server
scripts/         Dev orchestration
tests/           Bun test suite
```

## Prerequisites

Install [Bun](https://bun.sh):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Optional: Docker Desktop for persistent MongoDB (`docker compose up -d mongodb`).

## Setup

```bash
bun install
cp .env.example .env.local   # optional — dev works without it
```

Without `MONGODB_URI`, the API uses an embedded in-memory MongoDB automatically.

With Docker:

```bash
bun run db:up
# set MONGODB_URI=mongodb://127.0.0.1:27017 in .env.local
```

## Development

```bash
bun run dev          # API on :3000 + Vite on :5173 (proxies /api)
bun run dev:server   # API only
bun run dev:client   # Vite only
bun test             # run tests
bun run typecheck    # TypeScript check
bun run build        # production client build
```

## API endpoints

- `GET /api/health` — service and database status
- `GET /api/records` — list sample records
- `POST /api/records` — create a sample record (`{ "title": "..." }`)
