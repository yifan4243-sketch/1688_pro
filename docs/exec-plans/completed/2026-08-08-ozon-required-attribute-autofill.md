# Plan: Ozon Required Attribute Autofill Convergence

## Goal

Make Ozon draft generation fill every required category attribute automatically
from retained 1688 evidence and live Ozon dictionary candidates. Manual editing
is an exception path only after bounded AI or Ozon API failures.

## Constraints

- Keep dictionary IDs restricted to the live candidate set for the selected
  description-category/type pair.
- Preserve existing valid values and system-owned defaults/special attributes.
- Retry missing or invalid AI decisions up to three total attempts.
- Preserve the existing `attributes` IPC response and add diagnostics only.
- Do not submit a listing to Ozon or merge the work into `main`.

## Checklist

- [x] Add regression coverage for automatic mouse-pad type selection.
- [x] Converge initial generation, missing retries, and editor retry on one
  candidate-constrained completion engine.
- [x] Add per-attribute decisions and explicit terminal failure reasons.
- [x] Remove the editor prefill early-return and keep it as an exception retry.
- [x] Update durable docs/generated context.
- [x] Run focused tests, `pnpm agent-context`, and `pnpm agent-verify`.
- [x] Commit the verified change on `codex` only.

## Decisions

- 2026-08-08: AI selects ambiguous dictionary values from real candidates;
  deterministic code validates IDs and owns system defaults only.
- 2026-08-08: Three automatic attempts are allowed. Remaining external-service
  or invalid-response failures become `needs_manual` with inspectable reasons.
- 2026-08-08: No automatic Ozon submission is part of this work.

## Progress Log

- 2026-08-08: Confirmed the mouse-pad category (`18262715/96808`) exposes one
  required type candidate (`8229 -> 96808`, `鼠标垫`). Confirmed initial and
  retry paths omit candidate contexts while the editor has a prefill short
  circuit.
- 2026-08-08: Replaced the split initial/retry/manual paths with a single
  candidate-constrained engine, complete dictionary pagination, targeted
  three-attempt retries, strict ID validation, and inspectable decisions.
- 2026-08-08: Removed the editor prefill early return and documented the
  automatic draft-generation contract.

## Verification

- Focused Vitest: 2 files, 146 tests passed.
- `pnpm test:unit`: 37 files, 362 tests passed.
- `pnpm desktop:build`: passed.
- `pnpm agent-context`: passed.
- `pnpm agent-verify`: passed.

## Rollback

Revert the unified attribute-completion engine, renderer integration, tests,
and documentation from the associated commit. Preserve unrelated `codex`
branch work.
