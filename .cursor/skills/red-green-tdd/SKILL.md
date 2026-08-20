---
name: red-green-tdd
description: Use when implementing any behavior change — failing-test-first, observe red for the right reason, minimum code to green, refactor with the suite as safety net. Required by AGENTS.md rule 7.
---

# Red-green TDD

Tests bolted on afterwards rationalize the code that exists. They miss the regressions that matter. Execution model is red → green → refactor.

## 1. RED

Write one test that names the behavior. `w2 wages require a source span`, not `extract`. Use real Zod schemas, real Hono `app.request()`, and real Mongo via `connectDb()`. Mock only at HTTP/time/fs boundaries (`.cursor/rules/testing.mdc`). Assert on observable output. Run `bun test path/to/file.test.ts`. **Do not proceed until you have observed red for the right reason** — not an import error, not a fixture bug.

If it passes immediately: the behavior already exists, the assertion is trivial, or the fixture is masking it.

## 2. GREEN

Smallest implementation that turns that test green. A second behavior gets its own red test. Re-run the target test and the suite. If something else broke, you found a regression — fix it.

## 3. REFACTOR

Now improve design. Consolidate duplication (rule 1). Fix smells in files you touched (rule 2). Re-run the gate: `bun run typecheck && bun test && bun run build`.

Then loop. Next behavior, next red test.

## Evidence

When reporting done, include: test name, red output (assertion that failed), green confirmation. A PR where tests arrive only after implementation commits violates discipline.

## Anti-patterns

- Writing implementation, then "adding coverage."
- Weakening the assertion until red goes away without implementing the behavior.
- Skipping red because "it's a prototype." Prototypes still need the review-flow contract pinned.
