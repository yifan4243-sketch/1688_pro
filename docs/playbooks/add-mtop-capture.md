# Playbook: Add Mtop Capture

1. Probe the browser flow manually only when needed and safe.
2. Capture the smallest stable endpoint/method/appId signal.
3. Add parsing logic under `src/session` when it is shared, or in the command
   module when it is command-specific.
4. Save representative payloads as tests fixtures when they do not contain
   sensitive account data.
5. Return structured `CliError` failures for timeout, login redirect,
   risk-control, and parse failure.
6. Update `docs/JSON_CONTRACTS.md` if the capture changes agent-facing output.
7. Run focused parser/capture tests, then `pnpm agent-context`.

