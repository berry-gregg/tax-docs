# Task 10 report — Documents + portal routes

**Status:** done

**Branch:** `feat/tax-docs-prototype`

**Commit:** `feat: add document upload, review-gate, and token-scoped portal routes`

## What landed

- `PipelineRunner` + `noopRunner` in `src/server/pipeline/runner.ts`. Real runner is Task 12.
- `createApp(opts?: { runner?: PipelineRunner })` injects the runner; defaults to `noopRunner`.
- CPA documents routes: upload (PDF ≤ `MAX_UPLOAD_BYTES`), list with `?group=`, detail, PDF stream, field accept/edit, trust gate, rerun.
- Token-scoped portal: GET 404 for unknown tokens (never 403); payload is firm/client/year/filingType/items with coarse `portalStatus` only. Upload is `uploadedBy: "client"` with inbound `document-uploaded` activity.
- Shared ingest helper used by CPA and portal uploads.

## Tests (red → green)

Red (routes unmounted): CPA upload expected 201 received 404; portal GET expected 200 received 404.

Green:

- `document routes > CPA upload stores a PDF, records activity, and starts the runner`
- `document routes > rejects a non-PDF upload with an explicit PDF message`
- `document routes > trusts a document only after every field is reviewed while needs-review`
- `document routes > rerun resets a failed document and restarts the runner`
- `portal routes > returns coarse portal status and never leaks extraction confidence` (`JSON.stringify` lacks `"confidence"`)
- `portal routes > unknown portal token returns 404 never 403`
- `portal routes > portal upload marks inbound activity and maps the item to processing`

**Gate:** `bun run typecheck && bun test && bun run build` — typecheck pass; 124 tests pass; Vite build pass.

## Concerns

- `app.ts` is shared with Tasks 9/11. Inbox/metrics mounts were preserved. Task 11 rewrote `createApp` during this work; document/portal mounts were restored before commit. Parent should confirm `createApp({ runner })` and `/api/documents` + `/api/portal` still exist after Task 11's commit.
- `documentListRowSchema` / `portalStateSchema` live in the route modules until Task 18 moves them to `src/shared/schemas/api.ts`.
