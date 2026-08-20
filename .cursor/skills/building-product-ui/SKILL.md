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
nav.ts + icons.ts + router.ts  →  render.ts (one layout tree)
fixtures + shared/schemas/shell.ts  →  page bodies (fixture-backed until real APIs)
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
| Inbox | `/inbox` | Inbox | Badge on nav, simple list |
| `/expenses` | `/documents` | List | Header + tabs + filter bar + dual-line table |
| `/accounting` | `/review` | List | Queue tabs, status column, export primary |
| `/people/all` | `/clients` | List | Entity avatar + name/email, Invite primary |
| `/settings/company-settings` | `/settings` | Settings | Underline tabs, dt/dd grid, Edit secondary |

Product ink is `#2e2e27`, ash `#707062`, hairline `#ebe8e5`, outline `#91917b`, success `#26763b`, warning `#876634`. Marketing ink `#0c0a08` and 6px buttons stay in DESIGN.md as history — never in `src/client/`.

## File SSOT

| Concern | File |
|---------|------|
| Routes | `src/client/app/router.ts` |
| Nav tree / badges / nesting | `src/client/app/nav.ts` |
| Feather marks | `src/client/app/icons.ts` (`feather-icons`, 12px nav / 16px actions) |
| All page markup | `src/client/app/render.ts` |
| Chrome + recipes | `src/client/styles/shell.css` |
| Button/badge primitives | `design-system/css/base.css` |
| Token values | `design-system/css/tokens.css` ← `design-tokens.json` |
| Client entry (history, collapse, palette, health) | `src/client/main.ts` |
| Command K index + filter | `src/client/app/command-palette.ts` |
| Favicon + sidebar brand | `design-system/gb-favicon.png` (`index.html` + `src/client/app/brand.ts`) |
| Fixture rows | `src/client/app/fixtures.ts` + `src/shared/schemas/shell.ts` |
| Shell tests | `tests/client/shell.test.ts` |

Do not add a parallel component folder that reimplements `.page-header`, `.data-table`, or `.nav-group`.

## Nav (the easy thing to get wrong)

Ramp’s sidebar is not “highlight the active `<a>`.”

- Idle top-level: ash label, transparent row, 12px Feather icon.
- **Expanded group:** the whole parent+children block gets `--surface-nav-active` (`#ebe8e5`) at `--radius-nav` (4px). Parent label turns ink.
- **Current child:** bone fill (`--surface-sidebar`) punched out of that wash — not another hairline chip.
- Nested labels share an empty `.nav-icon-spacer` (12px) so they line up under the parent text, not under the icon.
- Children exist in `nav.ts` but only render when that group is the current page.
- Settings is a footer item, same row language, Feather `settings` (the gear that looked janky was a hand path).
- Count badges: highlighter, pill, ~22px. They are the only yellow in the nav.

Collapsed: 60px column, labels/children/badges/search keys hidden, icons at 16px (`--icon-size-nav-collapsed`). The GB mark grows to 28px (`--icon-size-brand-collapsed`) and is centered in the header slot (`justify-content: center` must override the expanded head’s `space-between`). The expand control (`data-collapse-nav`) is absolutely overlaid on that mark and stays at `opacity: 0` until `.sidebar-head:hover` or `:focus-within`. Do not stack logo and toggle as two visible rows in the rail.

## Page recipes

Reuse the helpers in `render.ts` (`pageHeader`, `tabs`, `toolbar`, `dataTable`, `entityCell`, `renderDocumentRow`). Copying their markup into a new function is a fork.

**Home** — scanning answer first. Time-of-day eyebrow (`greeting.ts`, never “Welcome back”). 28px/400 title with negative tracking stating the queue. Wash card (`12px`, bone fill, no border) for the one-paragraph next step. `.row-list` of dual-line rows (avatar, title, muted meta, status). Right rail: stacked `.btn-block` (one primary, rest secondary) then `.rail-widget` links separated by hairline. No table on Home.

**List** — this is Expenses/Accounting/People. Title + ash count on the left; kebab + optional secondary + **one** highlighter primary on the right. Underline tabs (active = ink + 2px ink border; counts in ash). Toolbar: 10px-radius search, ghost “Add filter”, download icon at `.toolbar-end`. Table: ash 14px headers, dual-line primary cell (32px avatar + title + muted sub), hairline row rules, semantic status, “1–N of N” footer. Workspace stays full-bleed white — no card wrapping the table.

**Inbox** — header + `.row-list`. Skip tabs/table until the data needs filters.

**Settings** — header, tabs, `.settings-block` max 720px, `.definition-grid` two-columns (dt ash, dd ink), secondary Edit. Health slots: `[data-api-status]` / `[data-db-status]`.

Unknown routes: inline empty page, not a toast.

## Adding a screen

1. Name the Ramp analog and pick **one** recipe. If it matches none, stop — that is a new pattern; inspect `try.ramp.com` and extend the recipe list in this skill + `product-shell.mdc` in the same change.
2. Red test in `tests/client/shell.test.ts` for the route, title, and a distinctive control.
3. Add the path in `router.ts` and the item in `nav.ts` (children only if Ramp would nest them).
4. Render through existing helpers. New CSS class only when no `.list-row` / `.data-table` / `.wash-card` / `.definition-grid` already does it.
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

## Anti-patterns

- Treating DESIGN.md’s marketing buttons (6px, `#0c0a08`) as app chrome.
- A new page with its own header/table CSS.
- Active nav = yellow fill or left border. Ramp uses wash + punch-out.
- Bone workspace or white sidebar.
- Drop shadows, gradients, extra accent colors, bold type.
- “Loading...” as visible copy (use a skeleton / health slot state).
- Modal for row detail; toast for field validation.
- Skipping the recipe because “this page is different.” If it is, document the fifth recipe first.
