# Windows CLI Compatibility

This spec defines the compatibility baseline required before `1688-cli` can
claim normal Windows command-line support.

## Goal

Make the installed CLI and local development workflow work from Windows
PowerShell and cmd.exe for read-only and daemon-backed commands.

## Scope

- npm package install and build scripts must not depend on Unix shell commands.
- The daemon IPC path must work on Windows named pipes and avoid collisions
  between different `BB1688_HOME` roots.
- Runtime paths, temporary files, and diagnostics must use Node path helpers
  instead of hard-coded Unix paths where they are part of normal command code.
- `doctor` fix hints must be executable or meaningful on Windows.
- README and command docs must show Windows alternatives where Unix examples
  use `jq`, shell assignment, `/tmp`, or `~/.1688`.
- Deterministic tests must cover the Windows-specific path and hint logic.
- CI/package verification must include a Windows-compatible build and smoke
  path, or document the exact manual Windows checks when CI is not available
  in the current environment.

## Non-Goals

- Do not bypass 1688 login, slider verification, or risk control.
- Do not automate Windows UI interaction beyond Playwright's existing browser
  launch behavior.
- Do not guarantee live 1688 network/search success in CI; CI checks should be
  deterministic and use `doctor --no-launch` unless a real account/session is
  explicitly supplied.
- Do not change public JSON contracts except by additive diagnostic fields.
- Do not add a new installer, native binary, or Windows service wrapper.

## Behavior Contract

### Build And Install

`pnpm build` must run on Windows, macOS, and Linux. Any executable-bit fix must
be implemented in Node and become a no-op on Windows.

`scripts/postinstall.mjs` must:

- locate the daemon pid file under `BB1688_HOME` when set
- detect Windows Chrome install paths
- invoke `npx.cmd` on Windows and `npx` elsewhere
- print retry commands that are valid for the current platform

### Daemon IPC

Unix-like platforms continue to use `<BB1688_HOME>/daemon.sock`.

Windows must use a named pipe:

```text
\\.\pipe\1688-cli-daemon-<stable-root-hash>
```

The hash must be stable for a given `BB1688_HOME`/default root and different
for different roots so tests, profiles, and concurrent users do not collide.

### Diagnostics

`1688 doctor` must emit platform-appropriate fix hints:

- Unix-like stale lock: `rm -rf "..."`
- Windows stale lock: `Remove-Item -Recurse -Force "..."`
- Unix-like writable-directory issue: `chmod u+w "..."`
- Windows writable-directory issue: explain to grant write permission or choose
  another `BB1688_HOME`

The daemon protocol documentation and README must not describe the daemon as
Unix-only.

### Documentation

README and command docs must include:

- PowerShell examples using built-in `--get`/`--pick` instead of requiring `jq`
- Windows output paths such as `$env:TEMP\suppliers.csv`
- Windows local state paths using `%USERPROFILE%\.1688` or `$env:USERPROFILE`
- named pipe note for daemon IPC on Windows

## Acceptance Criteria

- `pnpm build` succeeds without requiring `chmod` from the shell.
- Unit tests cover Windows named pipe generation and platform-specific doctor
  hints.
- `pnpm test:unit` passes.
- `pnpm agent-verify` passes.
- `npm pack --dry-run` succeeds.
- README and `docs/COMMANDS.md` no longer present Unix-only examples as the
  only way to use JSON, output files, or local paths.
- Manual Windows smoke checklist is documented:
  - `npm i -g 1688-cli`
  - `1688 --version`
  - `1688 doctor --no-launch --json`
  - `1688 daemon start`
  - `1688 daemon status --json`
  - `1688 daemon stop`
  - `1688 search 雨伞 --max 1 --json`
  - `1688 supplier search 键盘 --max 1 --json`

## Verification Signals

- Focused tests:
  - `tests/paths.test.ts`
  - `tests/doctor.test.ts` or existing doctor tests
- Package checks:
  - `pnpm build`
  - `pnpm test:unit`
  - `pnpm agent-verify`
  - `npm pack --dry-run`
- Manual Windows smoke checks listed above when a Windows machine/session is
  available.

## Open Questions

- Whether to add GitHub Actions `windows-latest` is a repository operations
  decision. The code/docs work should make that job straightforward, but adding
  CI config is not required unless the repository already uses GitHub Actions.
