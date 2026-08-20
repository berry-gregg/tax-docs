# Cursor agent configuration — tax-docs

This directory configures Cursor for this repo. Discipline is ported from Nucleus (Claude Code) and adapted to Cursor's harness.

tax-docs is a Ramp-inspired surface for CPA document collection, extraction, review, and tax-engine prep.

## Directory structure

```
.cursor/
├── README.md              # This file
├── rules/                 # Path-scoped or always-on .mdc contracts
└── skills/                # Workflow guides (description-triggered)
```

`AGENTS.md` at the repo root is the religious core (every session). `CLAUDE.md` points at it so Claude Code, if used, does not fork a second core.

## Rules (`.cursor/rules/`)

Cursor loads `.mdc` files using `globs:` and `alwaysApply:` (not Claude's `paths:`).

| Rule | Applies | Key contract |
|------|---------|--------------|
| `docs-discipline.mdc` | `AGENTS.md`, `.cursor/**`, `docs/**` | Three-rung ladder: AGENTS.md / rule / skill |
| `typescript.mdc` | `*.ts`, tsconfig, package.json | Strict TS, Bun, `.ts` imports, Zod-inferred types |
| `server.mdc` | `src/server/**`, `scripts/**` | Hono factory, Zod on entry, config SSOT |
| `data-store.mdc` | db + schemas | MongoDB documents, `collectionNames` SSOT, parse on read, auto-seed |
| `security.mdc` | always | Secrets, prompt fences, 404-not-403, HITL writes |
| `testing.mdc` | tests + src | `bun:test`, real Mongo, no internal mocks, TDD |
| `web-ui.mdc` | HTML/CSS/TS | CPA review console: states, CTAs, voice, a11y |
| `product-shell.mdc` | `src/client/**`, `tests/client/**` | Ramp chrome composition: layout, nav nesting, page recipes, API-driven page registry |
| `design-system.mdc` | design-system + styles | Ramp tokens are the visual SSOT |
| `agentic-systems.mdc` | agent/LLM/extract/review paths | Honest failure, `fences.ts`, pipeline stages, autonomy vs confirm |

## Skills (`.cursor/skills/`)

| Skill | Use when |
|-------|----------|
| `keeping-docs-fresh` | Behavior, architecture, or convention changed — update docs in the same change |
| `red-green-tdd` | Implementing any behavior change |
| `implement-plan-task` | Executing a written plan item |
| `parallelizing-dev-work` | Planning waves or dispatching parallel Task subagents |
| `building-product-ui` | Adding or changing product pages, nav, tables, icons, or matching try.ramp.com |

`bun run smoke` (`scripts/smoke-llm.ts`) is a live OpenRouter pipeline check. It is not part of `bun test` or the pre-commit gate.

## Adding new components

### New rule

1. Create `.cursor/rules/<name>.mdc` with YAML frontmatter (`description`, `globs` and/or `alwaysApply`).
2. One concern per rule. Keep it actionable; put decision history in a skill.
3. Index it here and in `AGENTS.md` in the same change.

### New skill

1. Create `.cursor/skills/<name>/SKILL.md` with `name:` + `description:` (third person, include **when** to use it).
2. Body: purpose, steps, anti-patterns.
3. Index it here and in `AGENTS.md`.

## Provenance

Ported from `berry-gregg/nucleus` `.claude/` (engineering rules 1–7, docs ladder, testing philosophy, admin-UI interaction principles, honest-failure / untrusted-data agent patterns). Dropped Nucleus-specific Temporal, Railway, Postgres/pydantic, tenant-AST, DaisyUI, and Claude `TeamCreate` machinery. Stack here is Bun + TypeScript + MongoDB + Zod + Hono. Cursor `Task` subagents replace agent teams.
