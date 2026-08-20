# Design System

Source-of-truth tokens and styles for the tax-docs web app.

## Structure

- `tokens/design-tokens.json` — W3C design tokens (JSON)
- `css/tokens.css` — CSS custom properties generated from tokens
- `css/base.css` — global reset, typography, and component primitives
- `docs/DESIGN.md` — full style reference and usage guide

## Usage

Import the app stylesheet from `src/styles/main.css`, which pulls in both CSS files:

```css
@import "../../design-system/css/tokens.css";
@import "../../design-system/css/base.css";
```

For Tailwind v4, copy the `@theme` block from `docs/DESIGN.md` into your Tailwind entry CSS.
