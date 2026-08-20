---
name: building-product-ui
description: How Ramp product chrome, tokens, and components compose into the tax-docs dashboard. Use when adding or changing pages, nav, tables, settings, icons, shell CSS, or when matching try.ramp.com / the Ramp dashboard look.
---

# Building product UI

The look is not tokens plus leftover CSS. It is a small set of surfaces, one typeface, one accent, and **four page recipes** assembled from shared primitives. Clone `try.ramp.com` (Home, Expenses, Accounting, People, Settings). Do not clone marketing `ramp.com`.

Invariants while editing files: `.cursor/rules/product-shell.mdc`. Token values: `.cursor/rules/design-system.mdc`. CPA voice/states: `.cursor/rules/web-ui.mdc`. Visual catalog: `design-system/docs/DESIGN.md`.

## How it composes

```
design-tokens.json  →  tokens.css  →  base.css (buttons, badge, type)
                                   →  shell.css (chrome + recipes)
nav.ts + icons.ts + router.ts  →  render.ts (shell + shared helpers)
shared/schemas/api.ts  →  app/api.ts  →  pages/*.ts  →  pages/registry.ts  →  main.ts loop
```

1. **Two surfaces.** Bone sidebar (`#f4f3ef`) is chrome. White workspace is work. Mixing those (bone page, white nav) reads as the marketing site.
2. **One accent.** Highlighter `#e4f222` is primary CTA, count badge, and “money/queue is live.” Status is olive green / brown / ash.
3. **One weight.** Chrome and titles are 400. Status/body may be 300. Size + tracking make hierarchy. Never 600/700.
4. **Hairline, not shadow.** Cards, rows, tabs, and tables sit on `1px #ebe8e5`. Flat on purpose.
5. **Comfortable density.** 32px nav rows, 40px buttons, 8/12/16/24 rhythm. Density is smaller controls and visible affordances, not cramped packing.
6. **Sentence case, no theater.** No “Welcome back.”, no emoji, no celebration banners. The data is the success state.

If a screen violates any of those six, it is not Ramp product UI even if the hex values match.

## Live source map

Sample computed styles from the product app, not screenshots of ramp.com.

| try.ramp.com | tax-docs | Recipe | Steal from it |
|--------------|----------|--------|----------------|
| `/home` | `/` | Home | Greeting, queue headline, wash card, recent rows, 298px rail |
| Inbox | `/inbox` | Inbox | Badge on nav, conversation threads |
| `/expenses` | `/documents` | List | Header + tabs + filter bar + dual-line table |
| `/accounting` | `/engagements` | List | Stage chips, progress column, export primary |
| `/people/all` | `/clients` | List | Entity avatar + name/email, New client primary |
| `/settings/company-settings` | `/settings` | Settings | Underline tabs, dt/dd grid, Edit secondary |
| Expense detail (receipt beside fields) | `/documents/:documentId` | Review | Sticky document frame on the left, compact editable field rows + single primary on the right |

Product ink is `#2e2e27`, ash `#707062`, hairline `#ebe8e5`, outline `#91917b`, success `#26763b`, warning `#876634`. Marketing ink `#0c0a08` and 6px buttons stay in DESIGN.md as history — never in `src/client/`.

## File SSOT

| Concern | File |
|---------|------|
| Routes (`Route` union, `parseRoute`) | `src/client/app/router.ts` |
| Nav tree / badge source / nesting / `navIdForRoute` | `src/client/app/nav.ts` |
| Feather marks | `src/client/app/icons.ts` (`feather-icons`, 12px nav / 16px actions) |
| Shell markup + shared page helpers | `src/client/app/render.ts` |
| Page modules (`load`/`render`/`bind`/`pollMs`) | `src/client/app/pages/*.ts` |
| Route → module resolution | `src/client/app/pages/registry.ts` |
| Fetch seam + `ApiError` + polling | `src/client/app/api.ts` |
| Wire shapes both ends parse | `src/shared/schemas/api.ts` |
| Money / confidence / relative time | `src/client/app/format.ts` |
| Chrome + recipes | `src/client/styles/shell.css` |
| Button/badge primitives | `design-system/css/base.css` |
| Token values | `design-system/css/tokens.css` ← `design-tokens.json` |
| Client entry (paint loop, history, collapse, palette, health) | `src/client/main.ts` |
| Command K filter (index injected by the shell) | `src/client/app/command-palette.ts` |
| Favicon + sidebar brand | `design-system/gb-favicon.png` (`index.html` + `src/client/app/brand.ts`) |
| Shell tests | `tests/client/shell.test.ts` |

Do not add a parallel component folder that reimplements `.page-header`, `.data-table`, or `.nav-group`. There is no fixture module — a page that needs data fetches it through `api.ts`.

## Nav (the easy thing to get wrong)

Ramp’s sidebar is not “highlight the active `<a>`.”

- Idle top-level: ash label, transparent row, 12px Feather icon.
- **Expanded group:** the whole parent+children block gets `--surface-nav-active` (`#ebe8e5`) at `--radius-nav` (4px). Parent label turns ink.
- **Current child:** bone fill (`--surface-sidebar`) punched out of that wash — not another hairline chip.
- Nested labels share an empty `.nav-icon-spacer` (12px) so they line up under the parent text, not under the icon.
- Children exist in `nav.ts` but only render when that group is the current page. The current child is the one whose `href` equals `pathname + search`, so `/documents?tab=needs-review` punches out "Needs review". If no child matches, punch out none — the parent group can stay active. Do not fall back to index 0.
- Settings is a footer item, same row language, Feather `settings` (the gear that looked janky was a hand path).
- Count badges: highlighter, pill, ~22px. They are the only yellow in the nav. Exactly two: Inbox (`/api/inbox/unread-count` — unread threads — into `[data-inbox-badge]`) and Documents (`needsReviewCount` from `/api/metrics` into `[data-documents-badge]`). Both live, hidden at zero, never a literal in `nav.ts`, and each must match the count its tab actually shows. No badges on other tabs.
- Engagements is Feather `briefcase`. There is no standalone Review tab: review is reached from a document row (`/documents/:documentId`) and keeps Documents current.

Collapsed: 60px column, labels/children/badges/search keys hidden, icons at 16px (`--icon-size-nav-collapsed`). The GB mark grows to 28px (`--icon-size-brand-collapsed`) and is centered in the header slot (`justify-content: center` must override the expanded head’s `space-between`). The expand control (`data-collapse-nav`) is absolutely overlaid on that mark and stays at `opacity: 0` until `.sidebar-head:hover` or `:focus-within`. Do not stack logo and toggle as two visible rows in the rail.

## Page recipes

Reuse the helpers in `render.ts` (`pageHeader`, `breadcrumbs`, `tabs`, `dataTable`, `bindRowLinks`, `entityCell`, `renderDocumentRow`) and the filter bar in `src/client/app/components/filter-bar.ts` (`filterSelect` / `filterBar` / `bindFilterBar`). Copying their markup into a new function is a fork. Detail pages put `breadcrumbs()` above `pageHeader`. Two-option modal choices use the `.segmented` recipe (visually-hidden real radios in styled labels — never raw browser radios, never chips). Checkboxes use the matching `.checkbox` recipe (visually-hidden input + drawn 16px `.checkbox-box`, ink fill when checked) — never a native checkbox. Wide horizontal-row modal flows add `.modal-panel-wide` (840px).

**Home** — scanning answer first. Time-of-day eyebrow (`greeting.ts`, never “Welcome back”). 28px/400 title with negative tracking stating the live queue count from `/api/metrics`. Wash card (`12px`, bone fill, no border) for the one-paragraph next step, with an honest empty variant when nothing is waiting. `.row-list` of dual-line rows (avatar, title, muted meta, pipeline chip) — the latest five documents, each deep-linking to its review page. No metrics ticker band (removed by operator ruling). Right rail: stacked `.btn-block` (one primary, rest secondary) then `.rail-widget` links separated by hairline. No table on Home.

**List** — this is Expenses/Accounting/People. Title + ash count on the left; optional secondary + **one** highlighter primary on the right when those actions are real. Filters are the `.filter-bar` between tabs and table: labeled native selects bound to real data, URL-synced, refetching server-side Mongo filters, with a quiet "Clear filters" link while active. Do not emit a kebab or download until they do something; free-text list search is not shipped. Bind `[data-href]` rows with `bindRowLinks` (one helper beside `dataTable`). Underline tabs (active = ink + 2px ink border; counts in ash). Table: ash 14px headers, dual-line primary cell (32px avatar + title + muted sub), hairline row rules, semantic status, “1–N of N” footer. Workspace stays full-bleed white — no card wrapping the table.

**Inbox** — conversations, not a checklist ledger: `pageHeader` with the unread-thread count, then `.inbox-threads` disclosure sections — one per engagement (client name, `{filingType} · {taxYear}`, latest-message preview truncated at 96 chars with a `You:` prefix for CPA-latest, relative time, portal-link control). Expanded body is the chronological timeline: `.inbox-msg` blocks (CPA right on `--surface-section`, client left on `--surface-wash`, hairline + radius, no chips) with quiet `.inbox-event` micro lines between them, then an `.inbox-compose` form (`data-preserve-focus` so poll repaints never steal focus; drafts survive repaints via a module map keyed by engagementId). Send posts `POST /api/inbox/threads/:engagementId/messages`, clears the draft, and repaints from a fresh load; failures show the server's message verbatim in `[data-compose-error]`. Expanding an unread thread marks it read via `POST /api/inbox/threads/:engagementId/read`; unread = client messages + inbound events only — the CPA's own outbound never counts.

**Settings** — header, tabs, `.settings-block` max 720px, `.definition-grid` two-columns (dt ash, dd ink). No Company-profile Edit control (there is no editor). Document-type writes surface `ApiError.message` on `[data-settings-error]` or `[data-schema-form-error]` and revert the Active toggle on failure. Health slots: `[data-api-status]` / `[data-db-status]`.

**Review** — the split pane at `/documents/:documentId`, analogous to Ramp's expense detail where the receipt sits beside the coded fields. `breadcrumbs([Documents, filename])` above a self-rendered `.page-header` (filename, type as ash count) whose `.page-actions` holds the one trust action top-right: **Mark trusted** while in review, **Open export** once trusted. No workspace link, no `.review-foot` footer. `.review-split` is two equal columns: left is a sticky `.review-viewer` hairline frame around `<iframe src="/api/documents/:id/file">`, right is `.review-panel`. The panel leads with the type name, `pipelineChip`, classification confidence, and the reasoning line, then ONE compact hairline row per extracted field: label + `10px` ash `metadataType` caption, an always-editable typed input pre-filled with `editedValue ?? value` (save-on-change; muted "Not found" placeholder when ungrounded; quiet Saving…/Saved/error hint; real `ApiError.message` inline on failure), confidence badge from `formatConfidence` (success/warning/ash, never highlighter), inline warning chip when `regexPass === false`, and a default-collapsed per-row "Source" disclosure. There are NO per-field Accept/Edit buttons — trusting the document auto-finalizes unreviewed fields. Validation shows only checks whose `relatedDocumentIds` include this document, passes included. The trust primary in `.page-actions` is enabled whenever the document is in `needs-review` with fields; zero extracted fields keeps it disabled with a muted explanation in the fields panel. Variant lanes replace the field list, never the split: `unclassified` offers the schema-builder side panel, `failed` and `rejected` show the stored cause with a rerun, in-pipeline states say so and let polling finish.

**Portal** — the chromeless client surface at `/portal/:token`. Three white `.portal-card` surfaces over the wash background (page max 1240px): the request checklist (required items first from the server; each item is one compact summary line — 16px status mark, ink title, ink-outline `Required` micro chip, file count — with description, nested files, and waive behind a `<details>` disclosure whose open state survives poll repaints; one item collects n files of its type), the common `.dropzone` with the live upload list, and a Messages panel (firm-name vs "You" rows, `data-preserve-focus` compose posting `POST /api/portal/:token/messages`, module-level draft). Primary copy is `--color-ink` — ash on the bone background was a readability regression. Pipeline stages surface through the `.chip` recipe with client-facing labels (Done / Needs attention), never internal ones.

Unknown routes: inline empty page, not a toast.

## Adding a screen

1. Name the Ramp analog and pick **one** recipe. If it matches none, stop — that is a new pattern; inspect `try.ramp.com` and extend the recipe list in this skill + `product-shell.mdc` in the same change.
2. Red test in `tests/client/<page>.test.ts` for the rendered title, a distinctive control, and the empty/error state. Shell-level concerns (nav, chrome, load states) go in `tests/client/shell.test.ts`.
3. Add the path in `router.ts`, the item in `nav.ts` (children only if Ramp would nest them), and a `PageModule` in `pages/registry.ts` replacing the placeholder.
4. `render` is a pure function of loaded data — assert on the returned string. Fetch only through `api.ts` with a schema from `src/shared/schemas/api.ts`. Set `pollMs` when the page shows pipeline state. Render through existing helpers; new CSS class only when no `.list-row` / `.data-table` / `.wash-card` / `.chip` / `.definition-grid` already does it.
5. New color/space/radius → token first (`design-tokens.json` + `tokens.css` + DESIGN.md), then class. Never a raw hex in `shell.css`.
6. Icons: add a name in `icons.ts` via `feather.icons[name].toSvg`. Nav 12px, in-page actions 16px. Stroke 2, viewBox 24.
7. Gate: `bun run typecheck && bun test && bun run build`.

## Re-inspecting Ramp

Re-open `try.ramp.com` when the user reports visual drift, or when adding a control not in the inventory (date picker, split pane, modal, toast, document viewer). Pull computed styles with the browser tools; do not trust marketing screenshots.

Do **not** re-sample `ramp.com` for app chrome. Do **not** introduce Lucide, Heroicons, Phosphor, or inline SVG paths because they “look close.” Ramp wraps Feather as `RyuIconSvg`.

Command palette: clone `try.ramp.com` Command K. Bone wash `rgba(244, 243, 239, 0.8)` — not a dark dim. White 640×432 panel, 0 radius, `--shadow-palette`. Header 56px with floating “Search Tax Docs” label, placeholder “Where do you want to go?”, 16px Feather search on the **right**, bottom rule `--color-input-hairline`. Results grouped (`Actions`, `Pages`, then query-matched `Documents` / `Clients`) with 12px ash section labels on `--surface-section` and 48px rows (16px icon + 16px/300 label). Hover/active fill is bone. Search lives in `command-palette.ts`; markup in `render.ts`. `.palette` is `display: grid`, so `[hidden]` is ignored unless `.palette[hidden] { display: none }` stays in `shell.css`.

Favicon and sidebar brand: `design-system/gb-favicon.png`. Tab icon is linked from `index.html`; the sidebar mark is imported in `src/client/app/brand.ts`. Do not add a second copy under `public/` unless Vite stops resolving the relative href. Do not revive the clip-path square.

## Decisions (do not reverse silently)

| Choice | Why | Reverse only if |
|--------|-----|-----------------|
| Product tokens, not marketing | Live app ink/radii differ from ramp.com | Re-sample try.ramp.com and update tokens + tests together |
| Feather via `feather-icons` | Same family as Ramp; hand paths made Settings look broken | Ramp ships a different set |
| Command K clones try.ramp.com | Bone wash, 640×432 panel, grouped rows, search icon on the right | Re-sample and update `command-palette.ts` + `shell.css` together |
| Favicon is `gb-favicon.png` | Operator-supplied mark in `design-system/` | A replacement PNG is provided |
| String HTML in `render.ts` | One layout tree, no second framework | An explicit UI-library decision |
| Home is the only rail page | Matches `/home`; list pages are full-bleed | A Ramp screen we clone uses a rail |
| Children only when group current | Matches Ramp expand/punch-out | We product-decide always-open sections |
| Highlighter scarce | Yellow = action/live count, not status | Never for “needs review” text |
| Page registry over a switch in `render.ts` | Each page owns its own load/render/poll; `moduleFor` is exhaustive so navigation cannot throw | A router library takes over resolution |
| Path-only `Route` union | `?tab=` / `?new=1` are view state; putting them in the union makes every module re-parse | A query value changes which module loads |
| Polling, not websockets | Pipeline progress is visible with one interval and no server push | Real-time volume outgrows `POLL_INTERVAL_MS` |
| Palette index injected by the shell | Typing never fires a request; the shell fetches once on first open | Search needs server-side ranking |
| No unbound list kebab / toolbar | Visible controls that do nothing are the loudest prototype signal; do not emit a toolbar until search is wired | A kebab, filter, download, or search is bound to a real action |
| Unmatched nav child: no punch-out | Falling back to index 0 punched "All" on `/documents?tab=trusted` | A child `href` equals `pathname + search` |

## Anti-patterns

- Treating DESIGN.md’s marketing buttons (6px, `#0c0a08`) as app chrome.
- A new page with its own header/table CSS.
- Active nav = yellow fill or left border. Ramp uses wash + punch-out.
- Bone workspace or white sidebar.
- Drop shadows, gradients, extra accent colors, bold type.
- “Loading...” as visible copy (use `renderPageSkeleton()` / a health slot state).
- A generic error line instead of the real `ApiError.message` plus retry.
- Hardcoded counts or a fixture module standing in for `/api`.
- Modal for row detail; toast for field validation.
- Skipping the recipe because “this page is different.” If it is, document the fifth recipe first.
- Shipping a kebab, “Add filter”, download, or search input that is not bound to a real action.
- Punching out the first nav child when no child `href` matches.
