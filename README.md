# tax-docs

Ramp-inspired surface for tax teams and CPA firms: collect the right client documents, classify and extract them, review trusted data with a human in the loop, and prepare it for tax engines.

## Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict)
- **API:** Hono (`src/server/`)
- **Database:** MongoDB (NoSQL) — in-memory for zero-setup dev, Docker for persistent local data
- **Client:** Vite + TypeScript app (`src/client/`) — Ramp product chrome plus an API-driven page registry
- **Validation:** Zod shared schemas (`src/shared/schemas/`), with wire shapes in `src/shared/schemas/api.ts`
- **AI:** OpenRouter multimodal PDF + structured outputs (`src/server/ai/openrouter.ts`)

## Project structure

```text
design-system/   Design tokens, CSS, and documentation
src/
  server/        Hono API, config, MongoDB, pipeline, seed, OpenRouter client
  client/        Vite app: shell chrome, param router, page registry, fetch layer
  shared/        Zod schemas and constants shared by client and server
scripts/         Dev orchestration, seed, demo-docs generator, live-LLM smoke
tests/           Bun test suite
demo-docs/       Tracked fictional TY2025 document pack + figures.json ledger
```

## Prerequisites

Install [Bun](https://bun.sh):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Optional: Docker Desktop for persistent MongoDB.

## Setup

```bash
bun install
cp .env.example .env.local   # optional — in-memory Mongo works without it
```

`src/server/config.ts` is the only `process.env` reader. Bun loads `.env.local` automatically.

OpenRouter (needed for the live pipeline and `bun run smoke`):

```text
OPENROUTER_API_KEY
OPENROUTER_MODEL          # optional; default is google/gemini-3.7-flash
```

Do not put values in this README. Leave keys in `.env.local` only.

Without `MONGODB_URI`, the API uses an embedded in-memory MongoDB and auto-seeds the demo book on first boot when the database is empty.

## Demo day

Two ways to run the book:

1. **Persistence** — `bun run db:up`, set `MONGODB_URI` in `.env.local` to the local Docker URI, then `bun run dev`. Seed once with `bun run seed` (or `bun run seed -- --reset` to rebuild).
2. **Zero-setup** — omit `MONGODB_URI`. The API starts an in-memory MongoDB and auto-seeds when empty. Data disappears when the process exits.

Regenerate the tracked PDF pack with `bun run demo-docs` (edit `scripts/generate-demo-docs.ts`, never the PDFs by hand).

`bun run smoke` uploads the Northgate P&L, the lease, and the apportionment schedule through the real OpenRouter pipeline. It is **manual** — not part of `bun test` or the pre-commit gate.

## Development

```bash
bun run dev          # API on :3000 + Vite on :5173 (proxies /api)
bun run dev:server   # API only
bun run dev:client   # Vite only
bun run seed         # seed the demo book if empty
bun run seed -- --reset
bun run demo-docs    # regenerate demo-docs/
bun run smoke        # live OpenRouter pipeline check (not in bun test)
bun test             # run tests
bun run typecheck    # TypeScript check
bun run build        # production client build
bun run preview
bun run db:up        # optional persistent MongoDB via Docker
bun run db:down
```

The pre-commit gate is `bun run typecheck`, `bun test`, and `bun run build`. `bun run smoke` is not in that gate.

## API endpoints

- `GET /api/health` — service and database status
- `GET /api/records` — list sample records
- `POST /api/records` — create a sample record (`{ "title": "..." }`)
- `GET /api/clients` — list clients
- `POST /api/clients` — create a client
- `GET /api/clients/:id` — client plus engagements
- `PATCH /api/clients/:id` — update a client
- `GET /api/engagements` — list engagements with client name and counts
- `POST /api/engagements` — create an engagement (optional checklist items)
- `GET /api/engagements/:id` — engagement detail (client, items, documents, activity)
- `PATCH /api/engagements/:id` — update engagement status
- `POST /api/engagements/:id/request-items` — add a checklist item
- `PATCH /api/engagements/:id/request-items/:itemId` — update a checklist item
- `DELETE /api/engagements/:id/request-items/:itemId` — remove a checklist item
- `GET /api/engagements/:id/validations` — warn-only cross-document checks
- `POST /api/engagements/:id/export` — build a draft engine export
- `GET /api/engagements/:id/export` — latest export for the engagement
- `POST /api/exports/:id/confirm` — human-confirmed send to the tax engine
- `GET /api/exports/:id/payload` — download the confirmed JSON payload
- `GET /api/document-types` — list document types
- `POST /api/document-types` — create a document type
- `GET /api/document-types/:id` — document type detail
- `PATCH /api/document-types/:id` — update a document type
- `GET /api/request-templates` — list request templates
- `PATCH /api/request-templates/:id` — update a request template
- `GET /api/documents` — list documents (`group=needs-review|approved|all`)
- `POST /api/documents` — CPA PDF upload (`file`, `engagementId`, optional `requestItemId`)
- `GET /api/documents/:id` — document plus document type when classified
- `GET /api/documents/:id/file` — stored PDF bytes
- `PATCH /api/documents/:id/fields/:key` — accept or edit an extracted field
- `POST /api/documents/:id/trust` — mark a reviewed document trusted
- `POST /api/documents/:id/rerun` — rerun `failed` / `unclassified` / `rejected`
- `POST /api/documents/:id/draft-type` — propose a schema for an unclassified document (not persisted)
- `GET /api/portal/:token` — coarse client-portal checklist (404 if the token is unknown)
- `POST /api/portal/:token/upload` — portal PDF upload
- `GET /api/inbox` — non-internal activity ledger (newest first) with joined `clientName`, `portalToken`, and `unread`
- `GET /api/inbox/unread-count` — inbound unread count
- `POST /api/inbox/:id/read` — mark an activity read (204)
- `GET /api/metrics` — live integer metrics (`documentsAutoProcessed`, `fieldsAwaitingReview`, `straightThroughRate`, `needsReviewCount`, `outstandingRequests`, `activeClients`)

`documentsAutoProcessed` and the straight-through rate count **trusted** documents only (not `needs-review`). Straight-through is `round(100 × trusted / terminal-ish)`, 0 when the denominator is empty. Terminal-ish statuses: `needs-review`, `trusted`, `rejected`, `unclassified`, `failed`.
