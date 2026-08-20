# Task 13 Report: Warn-only validation checks

Status: implemented and verified on `feat/tax-docs-prototype`.

Red phase: `bun test tests/server/validation-checks.test.ts` failed because `GET /api/engagements/:id/validations` returned 404 instead of 200.

Implementation:
- Added `computeValidations(engagementId)` in `src/server/validation/checks.ts`.
- Added `GET /api/engagements/:id/validations` in `src/server/routes/engagements.ts`.
- Added validation coverage in `tests/server/validation-checks.test.ts`.

Behavior covered:
- Balance sheet, trial balance, and P&L tie checks emit `pass` when values tie within tolerance.
- Payroll mismatch emits `warn` and names the 941 total, P&L payroll total, and difference.
- EIN/TIN consistency normalizes digits and excludes `recipient_tin`.
- Missing inputs omit checks instead of inventing passes.
- Open required request items emit `warn`; none open emits `pass`.
- Returned checks parse through `validationCheckSchema` and statuses are only `pass` or `warn`.

Verification:
- Focused red: `bun test tests/server/validation-checks.test.ts` failed with expected 404.
- Focused green: `bun test tests/server/validation-checks.test.ts` passed, 5 tests.
- Gate: `bun run typecheck`; `bun test`; `bun run build` passed.

Concerns:
- `src/server/routes/engagements.ts` also contains concurrent Task 14 export route changes; this task preserved them and staged only the validation additions.
