# Design System

Source-of-truth tokens and styles for the tax-docs web app.

## Structure

- `tokens/design-tokens.json` — W3C design tokens (JSON)
- `css/tokens.css` — CSS custom properties generated from tokens
- `css/base.css` — global reset, typography, and component primitives
- `docs/DESIGN.md` — full style reference and usage guide
- `gb-favicon.png` — product favicon and sidebar brand (GB on highlighter)

## Usage

Import the app stylesheet from `src/client/styles/main.css`, which pulls in tokens, base, and the product shell:

```css
@import "../../../design-system/css/tokens.css";
@import "../../../design-system/css/base.css";
@import "./shell.css";
```

For Tailwind v4, copy the `@theme` block from `docs/DESIGN.md` into your Tailwind entry CSS.
