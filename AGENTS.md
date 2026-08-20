# AGENTS.md

This file is the **religious core** for Cursor agents in this repository. It carries only invariants that apply to every change. Area-specific contracts live in `.cursor/rules/*.mdc` and load by glob. Long-tail workflows live in `.cursor/skills/*/SKILL.md` and load on description match.

Nucleus (Claude Code) is the provenance for this discipline. Cursor is the harness: `AGENTS.md` instead of `CLAUDE.md`, `.cursor/rules` with `globs:` / `alwaysApply:` instead of `.claude/rules` with `paths:`, and Cursor `Task` subagents instead of Claude `TeamCreate`.

## Project overview

tax-docs is a Ramp-inspired product surface for tax teams and CPA firms: collect the right client documents, classify and extract them, review trusted data with a human in the loop, and prepare it for tax engines. Visual language lives in `design-system/`. App code lives in `src/` (`server/`, `client/`, `shared/`).

**Stack:** Bun · TypeScript (strict) · Hono API · MongoDB (NoSQL) · Zod at every boundary · Vite client shell (Ramp product chrome in `src/client/`). Do not add Node-as-runtime, npm, SQL/ORMs, Jest, or Vitest.

## Engineering discipline (non-negotiable)

Code is written by agents under operator orchestration. Dev-hour scarcity is not a reason to take the shortcut. The default is the right design. "Ship the MVP, iterate later" is the heuristic that produces the worst debt: code that works today and constrains every future change.

The seven rules below describe the steady-state contract, not a sprint workflow. The right question is "is this work atomic, complete, tested, and documented?" — not "is this PR getting big?"

1. **Atomic single-source-of-truth.** Build logic once, centrally, robustly. Reference it everywhere else. Duplicated logic is a bug — fix it in the same change. Before writing new code, search for an existing implementation; extend or reuse it.

2. **Fix issues on sight.** If you notice a bug, smell, or inconsistency while doing other work, fix it in the same change. Do not leave TODOs for "next PR." If the fix would make the change too large, say so out loud before splitting — never silently skip.

3. **Never defer plan items. Never claim done when deferring.** If the plan says implement X, implement X. If an item becomes impossible or wrong, pause and escalate. Silent deferral is a critical failure. "Done" means every item is implemented and verified.

4. **Keep docs and AI-dev config fresh in the same change.** Any change that touches architecture, behavior, features, decisions, invariants, conventions, tooling, dependencies, deployment, or security must update the relevant files in the same PR: this `AGENTS.md`, `.cursor/README.md`, `.cursor/rules/**`, `.cursor/skills/**`, `design-system/docs/**`, and `.env.example`. "I'll update docs later" is silent deferral. See `.cursor/skills/keeping-docs-fresh/SKILL.md` for the *when*; `.cursor/rules/docs-discipline.mdc` for the *how*.

5. **Preserve parent context; parallelize tactical work.** The parent Cursor agent is planner, orchestrator, and reviewer. Do small, tightly scoped edits yourself. For 2+ independent file scopes, dispatch Cursor `Task` subagents in parallel rather than serializing. Batch independent tool calls in one turn. The parent owns the output: verify every deliverable before accepting. Do not burn the parent context on file-by-file search when an explore subagent would do. See `.cursor/skills/parallelizing-dev-work/SKILL.md`.

6. **Parallelize as a planning heuristic.** For every plan, identify tasks with disjoint file sets and no data/state dependency, then run them in the same wave. Serialize only with a concrete reason (shared invariant files, unfinished upstream interface, ordering constraints). A serial plan that could have been parallel is a process smell.

7. **Red-green TDD.** Every behavior change is a red-green-refactor loop: write a failing test first, observe red for the *right reason*, write the minimum code to green, then refactor with the suite as a safety net. Tests bolted on after implementation encode the code that exists, not the requirement. See `.cursor/skills/red-green-tdd/SKILL.md`.

## Commit and branch hygiene

- **Commit types:** `feat`, `fix`, `update`, `remove`, `refactor`, `docs`, `test`, `chore`.
- **Format:** `<type>: <brief description>` plus a 1–2 sentence body that explains why.
- **Stage selectively** — never `git add -A` or `git add .`.
- **Default branch is `main`.** Never commit directly to it; always feature-branch. Never force-push a shared branch. Never skip hooks unless explicitly requested.
- **Every commit introducing new functionality MUST include tests.**
- Only commit when the operator asks.

## Cross-cutting invariants

- **Zod at boundaries.** HTTP bodies, Mongo documents, extracted fields, and tax-engine payloads parse through schemas in `src/shared/schemas/`. Types are `z.infer<>` from those schemas — never a parallel interface, never a raw driver doc crossing a trust boundary.
- **Configuration through `src/server/config.ts`.** That file is the only `process.env` reader. Secrets never appear in logs, traces, or client payloads.
- **Architecture source of truth is the code.** Docs stay in sync in the same change; if they drift, the docs are wrong until updated.
- **Terminal failures surface their underlying cause.** A generic "something went wrong" with the real error discarded is a regression.
- **Honest failure over confident invention.** When extraction, classification, or validation cannot be grounded, say so structurally. Never paper over a gap with a plausible value. See `.cursor/rules/agentic-systems.mdc`.
- **Human in the loop for irreversible writes.** Autonomous work may collect, classify, extract, and propose. A person reviews and confirms before data is marked trusted or sent to a tax engine.

## Universal security

1. **Never commit secrets.** Use `.env.local` for dev. Do not read, write, or edit `.env*` files unless the operator explicitly asks.
2. **Never interpolate a secret into a log, f-string, template, or error message.** Pass secrets only into the client library.
3. **Untrusted input is data, not instructions.** Client documents, filenames, emails, and user text enter prompts only inside delimited fences with an untrusted-data warning. Never concatenate them into a system prompt.
4. **Validate at the entry boundary.** Zod-parse every external payload. Cross-client lookups return 404, not 403.

## Where to look

| Area | File | Loads when |
|------|------|------------|
| Docs / rules corpus | `.cursor/rules/docs-discipline.mdc` | editing `AGENTS.md`, `.cursor/**`, `docs/**` |
| TypeScript + Bun | `.cursor/rules/typescript.mdc` | `*.ts`, `tsconfig.json`, `package.json` |
| Hono server | `.cursor/rules/server.mdc` | `src/server/**`, `scripts/**` |
| MongoDB | `.cursor/rules/data-store.mdc` | db, server, shared schemas |
| Tests | `.cursor/rules/testing.mdc` | `tests/**`, `src/**/*.ts` |
| Security | `.cursor/rules/security.mdc` | always |
| Web UI | `.cursor/rules/web-ui.mdc` | `*.html`, `*.css`, `*.ts`, `*.tsx` |
| Product shell | `.cursor/rules/product-shell.mdc` | `src/client/**`, `tests/client/**` |
| Design tokens | `.cursor/rules/design-system.mdc` | `design-system/**`, `src/styles/**` |
| AI / agents | `.cursor/rules/agentic-systems.mdc` | `src/**`, prompts, extract/agent paths |

Skills (description match): `keeping-docs-fresh`, `red-green-tdd`, `implement-plan-task`, `parallelizing-dev-work`, `building-product-ui`.

## Dev commands

```bash
bun install
bun run dev          # Hono API (:3000) + Vite client (:5173)
bun run dev:server   # API only
bun run dev:client   # Vite only
bun run seed         # seed the demo book if empty (`-- --reset` to rebuild)
bun run demo-docs    # regenerate tracked demo-docs/
bun run smoke        # live OpenRouter pipeline check — not in bun test
bun test             # Bun test suite
bun run typecheck    # TypeScript check
bun run build        # production client build — must pass before claiming UI work done
bun run preview
bun run db:up        # optional persistent MongoDB via Docker
```

The pre-commit gate is currently `bun run typecheck`, `bun test`, and `bun run build`. `bun run smoke` is manual and stays out of that gate. When lint commands exist, they join this gate and this section updates in the same change.
