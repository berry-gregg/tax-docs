# Task 14 Report: Engine line map + export routes

## Status

Implemented Task 14 on `feat/tax-docs-prototype`.

## Changes

- Added `ENGINE_LINE_MAP` for 1120-S and 1065 mapped lines in `src/server/export/engine-map.ts`.
- Added `buildExportLines(engagementId)` that reads trusted documents only, sums numeric values across sources, returns `null` and empty `sourceRefs` for missing sources, and parses each line through `exportLineSchema`.
- Added `src/server/routes/exports.ts` for `POST /api/exports/:id/confirm` and `GET /api/exports/:id/payload`.
- Added engagement-scoped `POST /api/engagements/:id/export` and `GET /api/engagements/:id/export` delegating into export logic.
- Mounted `/api/exports` in `src/server/app.ts`.

## TDD Evidence

- RED: `bun test tests/server/engine-map.test.ts tests/server/exports-routes.test.ts`
  - `POST /api/engagements/:id/export` returned 404.
  - `POST /api/exports/:id/confirm` was unreachable because no draft export existed.
  - `engine-map.ts` was not yet present.
- GREEN: same target test command passed with 5 tests and 58 assertions.

## Verification

- `bun run typecheck`
- `bun test`
- `bun run build`

Full gate passed via PowerShell-compatible sequencing:

```powershell
$env:PATH='C:\Users\berry\.bun\bin;'+$env:PATH; bun run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; bun test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; bun run build
```

## Concerns

- The initial literal `&&` gate command failed because this PowerShell version does not accept `&&`; the equivalent sequenced gate passed.
- `src/server/routes/engagements.ts` already contained parallel Task 13 validation changes in the working tree. They were preserved and should not be included in the Task 14 commit.

## Fix Round 1

### Changes

- Added a regression test for confirming a draft, rebuilding a new draft for the same engagement, and then fetching the latest export.
- Added `createdAt` to `exportSchema` and stamped draft exports with it so every export has an ordering timestamp.
- Changed `getLatestExportForEngagement` to sort by `createdAt` instead of `confirmedAt`, so newer drafts win over older sent exports.
- Preserved the original `createdAt` when replacing an existing draft; new drafts are stamped after the latest existing export timestamp when needed.

### TDD Evidence

- RED: `$env:PATH='C:\Users\berry\.bun\bin;'+$env:PATH; bun test tests/server/exports-routes.test.ts`
  - New test failed because latest returned the older sent export: expected `{ id: <second draft>, status: "draft" }`, received `{ id: <confirmed export>, status: "sent", confirmedAt: ... }`.
- GREEN: same target command passed with 4 tests and 27 assertions.

### Covering Tests

- `tests/server/exports-routes.test.ts`
- `tests/server/engine-map.test.ts` (covered by the full suite; not touched in this fix)
- `tests/shared/engagement-schemas.test.ts`

### Verification

Command run:

```cmd
cmd /c "set PATH=C:\Users\berry\.bun\bin;%PATH% && bun run typecheck && bun test && bun run build"
```

Output:

```text
$ tsc --noEmit
161 pass
0 fail
798 expect() calls
$ vite build
✓ built in 481ms
```

### Concerns

- `createdAt` was not present on `exportSchema` in the prior implementation, although the fix brief expected an always-present export timestamp. The schema was updated as the minimum Zod-boundary change needed to implement latest-export ordering correctly.
