# Task 18 report — Client framework: API layer, param router, nav, page registry, live Home

**Status:** DONE_WITH_CONCERNS
**Branch:** `feat/tax-docs-prototype`
**Commit:** `b6ce91b` — `feat: replace fixture shell with API-driven page framework and live home` (41 files, +2239 / −748)
**Gate:** `bun run typecheck` clean · `bun test` 216 pass / 0 fail across 32 files · `bun run build` ✓ built in 551ms

---

## What I did

### 1. Shared wire-shape SSOT — `src/shared/schemas/api.ts` (new)

All `/api/*` row and response shapes now live in one file that both ends parse:

- `engagementListRowSchema` (+ `engagementListResponseSchema`), `engagementDetailSchema`
- `documentListRowSchema` (+ `documentListResponseSchema`)
- `inboxEntrySchema` (+ `inboxListResponseSchema`), `inboxUnreadCountSchema`
- `metricsSchema`
- `portalStatusSchema` / `portalStateSchema`
- `clientListResponseSchema` (needed by the palette index; Task 20 reuses it)

Consolidation performed in the same change (AGENTS rule 1 — these were four separate declarations):

| Was | Now |
|-----|-----|
| `src/shared/schemas/inbox.ts` | deleted → `api.ts` |
| `src/shared/schemas/metrics.ts` | deleted → `api.ts` |
| `documentListRowSchema` in `src/server/routes/documents.ts` | → `api.ts` |
| `portalStateSchema` + `FIRM_NAME` in `src/server/routes/portal.ts` | schema → `api.ts`, `FIRM_NAME` → `src/shared/constants.ts` (a shared schema cannot import from `src/server/`) |

`src/shared/schemas/shell.ts` and `tests/shared/shell-schema.test.ts` were deleted with the fixtures they existed to validate.

### 2. Server routes — payload shaping only

- `engagements.ts`: list rows parse through `engagementListRowSchema`, list response through `engagementListResponseSchema`, detail through `engagementDetailSchema` (previously unparsed object literals).
- `documents.ts`: list response through `documentListResponseSchema`; local row schema removed.
- `inbox.ts`: list response through `inboxListResponseSchema`; imports moved to `api.ts`.
- `metrics.ts`, `portal.ts`: imports moved to `api.ts`; portal keeps its identical output.

No response shape changed — `createApp` untouched, no wiring need.

### 3. Client framework

| File | Role |
|------|------|
| `app/api.ts` (new) | `ApiError { status }`, `getJson`, `sendJson`, `uploadFile`, `startPolling`. Failure message is the server's own `{ error }` string verbatim; falls back to the status line only when the body carries none. Schema mismatch throws an `ApiError` naming the path. A rejected poll tick logs and the loop continues. |
| `app/format.ts` (new) | `formatMoney`, `formatConfidence` (≥0.9 high / ≥0.7 medium), `formatRelativeTime(iso, now?)` — unparseable input returns `"Unknown date"` rather than a guessed distance. |
| `app/router.ts` | `Route` union + `parseRoute`. Path-only; trailing slashes normalised, params percent-decoded, wrong arities are `not-found` (`/engagements/e1/review` does not silently become an engagement). |
| `app/nav.ts` | Inbox / Home / Documents (All, Needs review) / Engagements / Clients, Settings in the footer. Review tab removed. `badge: "inbox-unread"` names a live source instead of a literal `3`. `navIdForRoute` keeps Engagements current for engagement, review, and export. |
| `app/icons.ts` | `engagements` = Feather `briefcase` at 12px/16px; dead `review` mark removed. |
| `app/pages/registry.ts` (new) | `PageModule<T>` + exhaustive `moduleFor`. Home is real; the ten routes owned by Tasks 19–25 get placeholders that render a titled body, so navigation can never throw. |
| `app/pages/home.ts` (new) | Live Home. |
| `app/render.ts` | Now shell + shared helpers only; page bodies are injected. Adds `renderPageSkeleton`, `renderLoadError`, `pipelineChip`, `listRow`, `railWidget`, `emptyState`, `initialsFor`, exported `escapeHtml`. Portal renders chromeless (`.app-chromeless`, no sidebar, no palette, no nav links). |
| `main.ts` | Async paint loop: `parseRoute` → `moduleFor` → skeleton → `load` → `render` → `bind` → `startPolling(pollMs)`. Polling stops on navigation; a `paintSequence` guard stops a slow load painting over a newer route; an unchanged poll tick leaves the DOM alone (and therefore does not rebind). Load failure renders the real message plus a retry button. |
| `app/command-palette.ts` | `searchPalette(query, index)` — Documents/Clients groups come from an injected `PaletteIndex` the shell fetches once on first open, so typing never fires a request. Actions now point at real routes (`/engagements?new=1`, `/documents?tab=needs-review`, `/clients?new=1`); the old `/review` action would have landed on not-found. |

### 4. Live Home

Headline `"{needsReviewCount} documents need review"` from `/api/metrics`; wash card reports `fieldsAwaitingReview` with an honest empty variant ("Nothing is waiting on you"); latest five rows from `/api/documents` deep-linking to `/engagements/:engagementId/review/:id` with pipeline chips; `.ticker` band with auto-processed / awaiting-review / straight-through %; rail = **New engagement** primary → `/engagements?new=1`, "Open review queue" secondary → `/documents?tab=needs-review`, then three widgets with live counts. `pollMs: POLL_INTERVAL_MS`.

### 5. `shell.css` — additive only, tokens only

`.app-chromeless` / `.workspace-portal`, `.ticker` (`--surface-inverted` band, 10px uppercase ash labels, 14px paper values), `.chip` + `.chip-processing|-warning|-success|-halted`, `.confidence-high|-medium|-low`, `.modal` / `.modal-panel`, `.side-panel` (+ head/body/foot), `.dropzone` (+ `.is-dragover`), `.page-skeleton` / `.skeleton-bar*`, `.load-error`. No new hex — a regression test now asserts `shell.css` contains no raw hex at all.

### 6. Docs refreshed in the same change

`.cursor/rules/product-shell.mdc` (new **Page framework** section, nav set, live badge, chip tones, recipes, anti-patterns), `.cursor/rules/server.mdc` (response shapes come from `api.ts`), `.cursor/skills/building-product-ui/SKILL.md` (composition diagram, file SSOT table, nav notes, Home recipe, "adding a screen" steps, four new decisions), `.cursor/README.md`, `README.md`. `index.html` no longer ships a fabricated "3 documents need review" pre-hydration line — it is now a skeleton.

---

## TDD evidence

### Step 1–2 — RED

Tests written first (`tests/client/router.test.ts`, `api-schemas.test.ts`, `api.test.ts`, `format.test.ts`, `home.test.ts`, `registry.test.ts`, `shell.test.ts`, `command-palette.test.ts`).

First run — module resolution, i.e. *not* valid red:

```
$ bun test tests/client
error: Cannot find module '../../src/client/app/api.ts' ...
SyntaxError: Export named 'parseRoute' not found in module '.../router.ts'.
SyntaxError: Export named 'renderLoadError' not found in module '.../render.ts'.
 0 pass / 8 fail / 8 errors
```

So I created signature-only stubs (`z.object({})` schemas, `return ""`, `throw new Error("not implemented")`) and re-ran to get red **on behavior**:

```
$ bun test tests/client
(fail) engagementListRowSchema > parses an engagement row joined with its client and counts
        error: expect(received).toBe(expected)
(fail) metricsSchema > rejects negative counts and fractional counts
        error: expect(received).toThrow()
(fail) getJson > throws ApiError carrying the server's error string verbatim
        error: expect(received).toBeInstanceOf(expected)
(fail) formatRelativeTime > collapses the last minute to just now
        error: expect(received).toBe(expected)
(fail) home page > ticker strip reports the three pipeline metrics
        error: expect(received).toContain(expected)
(fail) parseRoute > maps the parameterised paths
        error: expect(received).toEqual(expected)
(fail) nav tree > is Inbox, Home, Documents, Engagements, Clients, and a Settings footer
(fail) app shell chrome > the portal route paints without the sidebar or the command palette
(fail) load states > a failed load shows the real server message and a retry control
(fail) shell.css page furniture > adds the ticker strip, pipeline chips, modal, side panel, ...
 16 pass / 60 fail
```

The 16 passes were pre-existing guards (tokens, favicon, collapsed sidebar, greeting) — confirmation the suite still pinned the old chrome.

### Step 3–4 — GREEN

```
$ bun test tests/client
 76 pass / 0 fail

$ bun run typecheck        # (surfaced the two stale test imports of the deleted schema files; fixed)
$ bun test
 216 pass / 0 fail — Ran 216 tests across 32 files. [58.02s]
$ bun run build
 ✓ built in 551ms
```

### Extra verification — live payloads against the seeded demo book

`main.ts` cannot be unit-tested here (no DOM in `bun:test`, and adding jsdom/happy-dom is forbidden), so I booted the real app in-process against the auto-seeded book and rendered Home from the real responses (throwaway script, not committed):

```
metrics {"documentsAutoProcessed":6,"fieldsAwaitingReview":21,"straightThroughRate":100,
         "needsReviewCount":3,"outstandingRequests":3,"activeClients":2}
documents=6 engagements=3 clients=3 inbox=15 unread=6
headline: 3 documents need review
recent rows: 5
chips: chip chip-success, chip chip-warning
ticker: 6 | 21 | 100%
badge: <span class="badge" data-inbox-badge>6</span>
review hrefs: 5
portal chromeless: true
```

All six shared schemas parsed the real server payloads, and the headline matched `metrics.needsReviewCount`. I also confirmed Vite serves the app shell for deep routes (SPA fallback), which the param router depends on:

```
/                            200 serves app shell
/engagements/e1/review/d1    200 serves app shell
/portal/tok                  200 serves app shell
/nope                        200 serves app shell
```

---

## Self-review

- **Plan items:** all five steps done. Every interface in the brief exists with the specified signature. Nothing deferred.
- **Rule 1 (SSOT):** four duplicate schema declarations consolidated; page helpers stayed in `render.ts` rather than being forked into pages.
- **Rule 2 (fix on sight):** palette actions pointing at the removed `/review` route, the hardcoded `badge: 3`, the dead `review` icon, and `index.html`'s fabricated review count were all fixed here rather than left as TODOs.
- **Security:** untrusted values (client names, filenames, error messages) all go through `escapeHtml`; a test asserts `<script>` in a client name is escaped and that `renderLoadError` does not inject markup. No secrets touched, no `.env*` read.
- **Honest failure:** `ApiError.message` is the server's string verbatim; `formatRelativeTime` returns `"Unknown date"` instead of guessing; the empty Home state says so instead of showing a stale count.
- **Design system:** no new colors, radii, weights, or shadows; a new test forbids raw hex in `shell.css`. Highlighter only on the Home primary and the inbox count badge; pipeline chips are ash/warning/success/hairline.
- **Scope:** did not build the pages owned by Tasks 19–25 beyond placeholders; did not touch `src/server/app.ts`, seed, pipeline, or AI files; did not add dependencies.

---

## Concerns

1. **`main.ts` has no automated coverage.** The paint loop, polling lifecycle, retry binding, and palette-index fetch are exercised only by the live in-process check above plus the production build. `bun:test` has no DOM and the stack forbids adding jsdom/happy-dom, Jest, or Vitest. Everything testable was extracted into pure modules (`router`, `registry`, `render`, `pages/home`, `api`, `format`) and is covered. If the operator wants the loop pinned, that needs a DOM-harness decision at the stack level.

2. **`"{needsReviewCount} documents need review"` is rendered verbatim per the brief**, so a single-item queue reads "1 documents need review". I did not pluralize because the brief and global constraints say to use the exact values verbatim. One line in `pages/home.ts` fixes it if you want it.

3. **The server-side schema move was a relocation, not a red-first behavior change.** Response shapes are byte-identical, so no test could have failed beforehand. I pinned it with contract assertions instead (`engagementListResponseSchema` / `engagementDetailSchema` / `documentListResponseSchema` / `portalStateSchema` parsed inside the existing route tests). Flagging it explicitly rather than claiming a red I did not observe.

4. **Placeholder pages are visible in the product until Tasks 19–25 land.** Each renders "<Title> is not built yet." That is the ambiguity resolution I was given, but a demo run before those tasks will show nine such pages.

5. **Home polls every 2s by re-running `load()`**, which refetches metrics and the full document list. Cheap on the demo book (6 documents), and the DOM is only rewritten when the markup actually changed, but it is not incremental. Fine for the prototype; would need narrowing at real volume.

6. **The command palette is now shell-fed.** Documents/Clients results come from a `PaletteIndex` fetched on first open. `searchPalette` stayed a pure function of (query, index), so it is still fully unit-tested — but if the fetch fails the palette silently degrades to Actions + Pages (logged to console, no user-facing error). That felt right for a search overlay; say the word if it should surface.

---

## Fix round 1 — inbox unread badge after shell replace

**Status:** DONE
**Commit:** `fix: apply inbox unread badge after shell replace`

Fixed the Important review finding in `src/client/main.ts`: the unread-count refresh now awaits `/api/inbox/unread-count`, persists `inboxUnreadCount`, then queries the current `[data-inbox-badge]` node before writing. The paint loop also awaits a badge refresh immediately after the post-load `renderShell(...)`, so fast-loading pages render the live badge after the shell replacement instead of relying only on the pre-load fire-and-forget refresh.

### TDD evidence

RED:

```text
$ bun test tests/client/main.test.ts
Expected: 0
Received: 1
(fail) refreshInboxBadgeState > queries the badge after awaiting the unread count and persists the count
```

GREEN:

```text
$ bun test tests/client/main.test.ts
1 pass
0 fail
```

### Verification

```text
$ bun run typecheck && bun test && bun run build
tsc --noEmit passed
277 pass / 0 fail across 43 files
vite build ✓ built in 564ms
```
