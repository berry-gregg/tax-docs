---
name: keeping-docs-fresh
description: Use when a code change touches behavior, architecture, conventions, security, deployment, dependencies, or invariants — establishes which AGENTS.md, .cursor, and docs files must be updated in the same change (the when of AGENTS.md rule 4; the how lives in docs-discipline).
---

# Keeping docs and AI-dev config fresh

Stale agent instructions actively mislead. Update them in the same change. "Docs in a follow-up" is silent deferral (AGENTS.md rule 3).

## Files that must stay current

| Path | When to update |
|------|----------------|
| `AGENTS.md` | Overview, commands, invariants, security, index of rules/skills |
| `.cursor/README.md` | Adding/removing anything under `.cursor/` |
| `.cursor/rules/*.mdc` | New patterns, invariants, anti-patterns |
| `.cursor/skills/*/SKILL.md` | New or changed workflows |
| `design-system/docs/DESIGN.md` | Token, type, or component language changes |
| `docs/**` | Architecture notes, ADRs, runbooks |
| `.env.example` | New env vars or changed defaults |
| `README.md` | Dev commands, project shape |

## Triggers

New pattern adopted or rejected; new convention; flipped default; dependency add/remove; new endpoint or agent tool; security posture change; new test-policy exception; deprecation.

Trivial internal refactors (rename a private helper) do not need docs. If a new contributor would want to know — document it.

## Workflow

1. Diff against the default branch.
2. For every changed file: does this invalidate a claim in `AGENTS.md` or `.cursor/**`?
3. Update everything that would now be wrong, in the same change.
4. Grep for old paths when renaming.

## Anti-patterns

- "I'll update docs later."
- Code that contradicts AGENTS.md with no AGENTS.md edit.
- New `.cursor/rules/` file with no index row in `.cursor/README.md` and `AGENTS.md`.
- New env var without `.env.example`.
- Broken cross-references left for a follow-up.
