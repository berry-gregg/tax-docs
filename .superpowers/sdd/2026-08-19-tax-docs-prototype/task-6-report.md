# Task 6 Report: Clients + engagements routes

## Status

Implemented and verified.

## Scope

- Added CPA-facing client routes in `src/server/routes/clients.ts`.
- Added engagement and request item routes in `src/server/routes/engagements.ts`.
- Mounted `clientRoutes` at `/api/clients` and `engagementRoutes` at `/api/engagements`.
- Added route coverage in `tests/server/clients-routes.test.ts` and `tests/server/engagements-routes.test.ts`.

## Behavior

- `GET /api/clients` returns `{ clients }`.
- `POST /api/clients` parses `createClientInputSchema`, creates a UUID-backed client, and returns `201 { client }`.
- `GET /api/clients/:id` returns `{ client, engagements }`, with 404 `{ error: "Not found" }` for missing ids.
- `PATCH /api/clients/:id` accepts partial create-client input and returns `{ client }`.
- `GET /api/engagements` returns engagement rows with `clientName`, `docCounts`, and `openItems`.
- `POST /api/engagements` parses `{ clientId, taxYear, filingType, items? }`, requires an existing client, creates a collecting engagement with `portalToken: randomUUID()`, instantiates request items from explicit `items` or the seeded request template, and writes outbound `request-sent` activity.
- `GET /api/engagements/:id` returns `{ engagement, client, requestItems, documents, activity }`.
- `PATCH /api/engagements/:id` parses `{ status }` with `engagementStatusSchema`.
- `POST /api/engagements/:id/request-items` creates an open request item.
- `PATCH /api/engagements/:id/request-items/:itemId` supports `status: "waived" | "open"`, `title`, `description`, and `required`.
- `DELETE /api/engagements/:id/request-items/:itemId` returns 204 after deletion.

## TDD Evidence

- Red: `bun test tests/server/clients-routes.test.ts tests/server/engagements-routes.test.ts` failed because the new endpoints returned 404 before the routes existed or were mounted.
- Green: the same focused command passed with 7 tests and 39 assertions after implementation.

## Verification

- `bun run typecheck` passed.
- `bun test` passed: 65 tests, 339 assertions.
- `bun run build` passed.
- Initial `bun run typecheck && bun test && bun run build` failed in PowerShell because `&&` was not accepted by the shell wrapper; the gate was rerun with equivalent PowerShell exit checks and passed.

## Commit

- `feat: add clients and engagements CRUD with template-driven request items`

## Concerns

- None.
