# Playbook: Add A Command

1. Add the Commander surface in `src/cli.ts`.
2. Create or update the owning module in `src/commands`.
3. Keep CLI parsing in `run(opts)` and browser/session work in
   `execute(ctx, args)` when daemon dispatch is needed.
4. Wire daemon dispatch in `src/session/dispatch.ts` if the command should run
   through the daemon.
5. Use `emit({ human, data })` so JSON/text dual mode stays consistent.
6. Add deterministic tests for parsing, output, mtop payload parsing, or helper
   behavior.
7. Update `docs/COMMANDS.md` and `docs/JSON_CONTRACTS.md` when behavior or
   output shape changes.
8. Run `pnpm agent-context` and the focused verification command.

