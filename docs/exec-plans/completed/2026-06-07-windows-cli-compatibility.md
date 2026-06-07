# Plan: Windows CLI Compatibility

## Goal

Deliver the Windows compatibility baseline from
`docs/specs/windows-cli-compatibility.md`: Windows-safe build/install scripts,
daemon named pipe isolation, platform-aware diagnostics, Windows-ready docs,
and deterministic verification.

## Context

- Source spec: `docs/specs/windows-cli-compatibility.md`
- Agent map: `AGENTS.md`
- Workflow: `docs/WORKFLOW.md`
- CLI/package surfaces: `package.json`, `scripts/postinstall.mjs`, `src/cli.ts`
- Path/daemon surfaces: `src/session/paths.ts`, `src/daemon/*`
- Diagnostic surface: `src/commands/doctor.ts`
- User docs: `README.md`, `docs/COMMANDS.md`
- Generated indexes: `docs/generated/*`

Existing behavior already has partial Windows support: daemon IPC uses a
named pipe on `win32`, postinstall checks common Windows Chrome paths, and
most runtime paths use `path.join`. Known gaps are shell `chmod` in
`package.json`, a fixed global named pipe, Unix-only doctor hints, Unix-only
README examples, and no deterministic Windows-specific tests.

## Non-goals

- Do not change 1688 login/risk-control behavior.
- Do not add a native Windows service, installer, or packaged executable.
- Do not add live Windows 1688 network checks to deterministic tests.
- Do not change existing command JSON shapes except additive diagnostics if
  needed.

## Design

- Replace shell `chmod` with a Node script that sets executable mode only on
  Unix-like platforms.
- Make Windows named pipe paths stable per root by hashing `root()`.
- Keep Unix socket paths unchanged.
- Centralize platform-specific diagnostic hint strings in `doctor`.
- Make postinstall resolve its pid file through `BB1688_HOME` and run
  `npx.cmd` on Windows.
- Use `os.tmpdir()` for production debug/probe output helpers that currently
  write hard-coded `/tmp` paths.
- Update README and command docs with PowerShell-safe examples while keeping
  Unix examples for shell users.
- Add deterministic tests that simulate Windows behavior without requiring a
  Windows host by exposing pure helper functions.

## Checklist

Spec and plan foundation:

- [x] Create Windows CLI compatibility spec.
- [x] Create active ExecPlan.

Implementation:

- [x] Add cross-platform bin-mode script and replace `chmod` build command.
- [x] Make Windows daemon named pipe unique per `BB1688_HOME` root.
- [x] Make postinstall daemon pid lookup, npx invocation, and retry hint
  platform-aware.
- [x] Make doctor fix hints platform-aware.
- [x] Replace production hard-coded `/tmp` debug dump paths with `os.tmpdir()`.
- [x] Add deterministic tests for Windows path/doctor/build helpers.

Docs and maps:

- [x] Update README Windows command-line guidance.
- [x] Update `docs/COMMANDS.md` Windows examples.
- [x] Run `pnpm agent-context` after command/doc/test layout changes.

Verification:

- [x] Run focused Windows compatibility tests.
- [x] Run `pnpm build`.
- [x] Run `pnpm test:unit`.
- [x] Run `pnpm agent-verify`.
- [x] Run `npm pack --dry-run`.

## Verification

Focused:

```bash
pnpm exec vitest run tests/paths.test.ts tests/doctor.test.ts tests/fix-bin-mode.test.ts
```

Package and project:

```bash
pnpm build
pnpm test:unit
pnpm agent-context
pnpm agent-verify
npm pack --dry-run
```

Manual Windows smoke when a Windows machine is available:

```powershell
npm i -g 1688-cli
1688 --version
1688 doctor --no-launch --json
1688 daemon start
1688 daemon status --json
1688 daemon stop
1688 search 雨伞 --max 1 --json
1688 supplier search 键盘 --max 1 --json
```

## Decisions

- 2026-06-07: Treat Windows support as a deterministic packaging/runtime
  compatibility baseline, not a guarantee that live 1688 network calls pass in
  CI without a logged-in account.
- 2026-06-07: Use `BB1688_HOME` root hashing for Windows named pipes so
  tests and users with different homes do not collide.

## Progress Log

- 2026-06-07: Created spec and active plan from user request.
- 2026-06-07: Implemented the Windows compatibility baseline: Node-based bin
  mode fixing, root-hashed Windows daemon named pipes, platform-aware
  postinstall and doctor hints, `os.tmpdir()` debug paths, PowerShell docs, and
  deterministic helper tests.
- 2026-06-07: Verified with focused Windows compatibility tests, `pnpm build`,
  `pnpm test:unit`, `pnpm agent-context`, `pnpm agent-verify`, and
  `npm pack --dry-run`. Manual Windows smoke remains documented for a real
  Windows session.

## Rollback

- Restore `package.json` build script to its previous `chmod` form.
- Restore `socketPath()` to the fixed Windows pipe.
- Revert postinstall, doctor, docs, and tests added by this plan.
- Run `pnpm agent-context` after rollback if generated indexes changed.
