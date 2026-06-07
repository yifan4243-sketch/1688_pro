# Playbook: Change JSON Output

1. Identify the stable result interface in `src/commands/*`.
2. Prefer additive fields. Do not rename or remove fields unless the user
   approved a breaking change.
3. Update human rendering only after preserving machine output.
4. Add or update tests for the JSON shape or parser feeding it.
5. Update `docs/JSON_CONTRACTS.md`.
6. Run `pnpm agent-context`.
7. Run `pnpm test` or a focused test plus `pnpm docs-check`.

