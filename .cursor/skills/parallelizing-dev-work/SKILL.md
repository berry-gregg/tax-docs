---
name: parallelizing-dev-work
description: Use when drafting an implementation plan or a work wave — how to find disjoint-scope sibling tasks and run them concurrently instead of serializing work with no real dependency. Use when dispatching Cursor Task subagents or batching tool calls.
---

# Parallelizing development work

The dominant waste in an agentic workflow is serial execution of independent work. Parallelism is a **planning** heuristic, not a dispatch-time afterthought. First question: what is the parallelism structure?

## Parallelize when

- File scopes are disjoint.
- No data/state dependency (B does not need A's output).
- Each piece is independently verifiable.
- Merge is mechanical.

## Serialize when

- Shared invariant files (`AGENTS.md`, design tokens, a single schema module both sides must extend).
- Downstream depends on an unfinished upstream interface.
- Ordering is semantic (migration before reader, token before consumer).

Default to parallel. Serialize only with a named reason. When in doubt about a merge collision on a shared file, serialize that file.

## Waves

Group tasks into waves. Wave 1 runs against current code. Wave 2 depends only on wave 1. Within a wave, dispatch together.

Cursor mechanics:

- Batch independent reads, greps, and searches in one turn.
- For 2+ independent implementation scopes, launch multiple `Task` subagents in one message. Give each a hard file-ownership guardrail: "Do not modify `design-system/`; the sibling owns it."
- Parent agent drafts the next wave while a wave runs. Parent does not start overlapping tactical edits on the same files.
- Explore subagent for codebase questions; parent keeps architecture and review.

## Anti-patterns

- Four-step chain of independent file-set tasks.
- Two subagents both editing `AGENTS.md` or the same CSS token file.
- Waiting for an unrelated test run before starting a disjoint UI change.
- Serial tool calls that have no dependency (search then search then search).
