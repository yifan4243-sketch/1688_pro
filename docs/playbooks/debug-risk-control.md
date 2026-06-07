# Playbook: Debug Risk Control

1. Confirm whether the failure is login redirect, risk-control URL, empty mtop
   capture, network error, or browser closure.
2. Check structured exit code behavior. Exit `3` should point to `1688 login`;
   exit `4` should point to rerunning once with `--headed`.
3. Use `--headed` only when manual slider solving is expected.
4. Inspect `src/session/page-state.ts`, `src/session/recovery.ts`, and the
   relevant command's capture logic.
5. Add fixture-backed tests for page-state or parser changes.
6. Do not add silent retry loops around risk-control failures.

