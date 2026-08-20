---
name: implement-plan-task
description: Use when executing a task from a written implementation plan — claiming the item, red-green TDD, verifying completeness, and escalating when the plan is wrong. Covers AGENTS.md rules 1–7 in execution order.
---

# Implement plan task

The plan is a contract. These rules override pressure to ship a smaller diff.

## Before touching code

Read the whole plan. Note acceptance criteria, dependencies, and suspicious items (wrong approach, invariant conflict, vague "done"). Escalate suspicious items before starting.

## For each item

1. Search for an existing implementation. Reuse or extend. Consolidate duplication in this change, or say out loud why not.
2. Red-green-refactor (`.cursor/skills/red-green-tdd/SKILL.md`).
3. Fix adjacent issues in files you touched. No TODOs.
4. Update docs/rules/skills if behavior or conventions changed.
5. Run the pre-commit gate: `bun run typecheck && bun test && bun run build`.

If 2+ items have disjoint file scopes, dispatch them in the same wave (`.cursor/skills/parallelizing-dev-work/SKILL.md`). Do small scoped edits in the parent agent; delegate larger independent chunks to Cursor `Task` subagents. The parent verifies before accepting.

## Done means

- [ ] Every plan item implemented (not stubbed, not deferred)
- [ ] Each item has a test that proves it
- [ ] Gate is green
- [ ] Adjacent issues fixed, not TODO'd
- [ ] Docs/AI-config match the code
- [ ] Status report does not say "done" if anything is missing

**"Done except X"** is acceptable if X is spelled out. **"Done"** with X silently missing is a lie.

## When the plan is wrong

If a step is impossible, conflicts with an invariant, or reality disproves it: stop, explain, propose an alternative, wait for agreement. Do not silently substitute a different design and still report the original item done.
