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

## Fix round 1/5

### Finding

Add tests for the produced request-item POST/DELETE routes and the client-detail engagement join. Unknown `clientId` on `POST /api/engagements` and cross-engagement item 404 were also untested.

### What changed

- `tests/server/clients-routes.test.ts`: POST client → POST engagement from the seeded 1120-S template → `GET /api/clients/:id` asserts the engagement is joined. Empty-join coverage in the original CRUD test is unchanged.
- `tests/server/engagements-routes.test.ts`: POST `/request-items` → 201, DELETE same item under a foreign engagement id → 404 `{ error: "Not found" }`, DELETE under the home engagement → 204 with empty body, repeat DELETE → 404. Unknown `clientId` on `POST /api/engagements` now asserts 404.
- No route code changes. Deferred Minors (`zodIssueSummary` helper, missing-template fail-open) left untouched.

### Covering tests

`bun test tests/server/clients-routes.test.ts tests/server/engagements-routes.test.ts`

9 pass, 0 fail, 59 expect() calls.

### Command

`bun run typecheck && bun test && bun run build`

### Output

- `tsc --noEmit` passed.
- `bun test` passed: 82 tests, 405 assertions.
- `vite build` passed.
