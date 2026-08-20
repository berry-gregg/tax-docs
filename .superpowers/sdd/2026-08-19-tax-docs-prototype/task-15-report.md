# Task 15 report — AI-drafted schema for unclassified documents

**Status:** complete. Gate green (`bun run typecheck`, `bun test` 160 pass / 0 fail, `bun run build`).

## What shipped

- **`src/server/pipeline/stages.ts`** — added `draftTypeResultSchema` and `runDraftTypeStage(ai, doc)`.
  - The result schema is composed from the existing SSOT, not re-declared: `name`/`description` reuse
    `documentTypeSchema.shape`, and each field is
    `fieldDefSchema.pick({ key, label, metadataType, description })`. So `key` inherits the snake_case
    regex and the model's output is rejected (and retried once by the client) if it violates it.
  - `dataType`, `required`, and `regex` are deliberately absent from the model's schema — they are the
    server's call.
  - `DRAFT_TYPE_SYSTEM` is trusted-only and interpolates `metadataTypeSchema.options` (our own constant).
    The document parts are the shared `documentParts()` helper: PDF file part + `fenceUntrusted("filename", …)`.
    No untrusted text reaches the system prompt.
- **`src/server/routes/documents.ts`** — added `POST /api/documents/:id/draft-type`.
  - `404` unknown id, `409` unless `pipelineStatus === "unclassified"` (checked before any model call).
  - Fills `dataType = defaultDataTypeFor(metadataType)`, `required: false`, no regex; returns
    `{ draft }` parsed through `createDocumentTypeInputSchema`. Nothing is persisted — no document type
    is created and the document's status is untouched.
  - A stage or storage failure returns `502` with the real underlying message (and logs it), per the
    terminal-failure invariant.
  - `createDocumentRoutes(runner, ai)` now takes the client as a second positional arg; sibling routes untouched.
- **`src/server/app.ts`** — `createApp(opts: { runner?, ai? })`. An omitted `ai` falls back to a local
  `unavailableAi` client that rejects with "No AI client was provided to createApp", so an unwired app
  fails loudly instead of reaching OpenRouter with whatever key is in the environment.
- **`src/server/index.ts`** — one client, shared: `const ai = createOpenRouterClient(); createApp({ runner: createRunner({ ai }), ai })`.
- **`.cursor/rules/server.mdc`** — documented the new `createApp` option and the 502-with-real-cause rule.

## Tests — `tests/server/draft-type.test.ts` (6 tests, 41 assertions)

Red first: `SyntaxError: Export named 'draftTypeResultSchema' not found in module … stages.ts`.

1. Stage sends `schemaName: "draft_type_result"`, a system prompt containing "snake_case",
   "do not propose values, only structure", and every `metadataTypeSchema` option; the filename and the
   untrusted warning never appear in the system prompt; parts are exactly `[pdfFilePart, fenced filename]`.
2. `draftTypeResultSchema` rejects a non-snake_case key.
3. Route returns a draft whose four fields default to `string`/`date`/`double`/`int` from their metadata
   types, all `required: false`, no `regex`, parses through `createDocumentTypeInputSchema`; the
   `document_types` collection stays empty and the document stays `unclassified`.
4. `409` (and zero model calls) for a `needs-review` document.
5. `404` for an unknown id.
6. A rejecting stub client surfaces `502` with "OpenRouter request timed out".

AI is stubbed at the `OpenRouterClient` seam; no network in tests.

## OPENROUTER directive

Fetched the live `structured-outputs` and `multimodal/pdfs` docs. The existing request shape in
`src/server/ai/openrouter.ts` (`response_format.json_schema` with `strict: true`, `plugins: [file-parser/native]`,
`file` part with `file_data` data URL) still matches the docs, so no client change was needed — this task
only adds a caller.

## Concerns for the parent

- **`README.md` "API endpoints" is stale** and lists only health/records/inbox/metrics. The documents,
  engagements, portal, document-types, and exports routes from Tasks 8–14 are all missing, so adding only
  `POST /api/documents/:id/draft-type` would have made the list look complete when it is not. Not fixed
  here to avoid clobbering a shared file mid-wave — flagging rather than silently deferring. Recommend one
  consolidating pass over the endpoint list once Wave 3 lands.
- `draftTypeResultSchema` sends a `pattern` keyword (the snake_case key regex) in the JSON schema. Gemini's
  structured-output schema supports `pattern`; a provider that does not would reject the request. If that
  ever shows up, the fix is to drop the regex from the wire schema and validate the key after parsing.
- Task 22 consumes this route (`{ draft }` prefills the schema-builder panel, then
  `POST /api/document-types` + `POST /api/documents/:id/rerun`).
