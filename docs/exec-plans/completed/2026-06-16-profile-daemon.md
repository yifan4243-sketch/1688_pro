# Plan: Profile Daemon

## Goal

Deliver profile-scoped daemon mode for `1688-cli`: one daemon, persistent
browser context, lock, and runtime artifact set per profile, with default
profile compatibility and deterministic verification.

## Context

- Source spec: `docs/specs/profile-daemon.md`.
- Read first:
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `docs/WORKFLOW.md`
  - `docs/COMMANDS.md`
  - `docs/JSON_CONTRACTS.md`
  - `docs/SAFETY.md`
  - `docs/RELIABILITY.md`
  - `docs/playbooks/add-command.md`
  - `src/session/paths.ts`
  - `src/session/lock.ts`
  - `src/session/context.ts`
  - `src/session/shared.ts`
  - `src/session/dispatch.ts`
  - `src/daemon/client.ts`
  - `src/daemon/manager.ts`
  - `src/daemon/server.ts`
  - `src/commands/login.ts`
  - `src/commands/doctor.ts`
  - `src/commands/profile.ts`
  - `src/cli.ts`
  - `tests/paths.test.ts`
  - `tests/profile.test.ts`
  - `tests/doctor.test.ts`

## Non-goals

- Do not implement a multi-profile daemon process.
- Do not change checkout confirmation safety.
- Do not run external live login/search/browser flows during verification.
- Do not introduce new dependencies.
- Do not refactor unrelated command behavior.

## Design

Use one profile-bound daemon process per profile. The profile is resolved to
`default` at the edge and then passed through path helpers, locks, daemon
client/manager/server, shared context, dispatch, login, doctor, and profile
status.

Runtime artifacts become profile-scoped via centralized helpers. Non-Windows
sockets live under a profile runtime directory; Windows named pipes include the
root hash plus a profile-derived hash/slug so profiles do not collide.

`dispatch` no longer treats `opts.profile` as a daemon skip condition. It
connects to the selected profile daemon, auto-starts or refreshes only that
daemon, and falls back inline only for that profile. Headed mode, `noDaemon`,
and `BB1688_NO_DAEMON=1` still skip daemon dispatch.

Inline fallback pauses only the selected profile daemon before opening an
inline context on that profile. Other profile daemons continue running.

`login --profile` writes profile-scoped state and attempts to start that
profile daemon unless `--no-daemon` is set. `doctor --profile` and
`profile status <name>` read profile-scoped state, lock, and daemon status.

Docs and generated indexes are updated because command flags, daemon behavior,
and source/test layout behavior changed.

## Checklist

- [x] Create spec/index and active ExecPlan for profile-scoped daemon work.
- [x] Implement profile-scoped path helpers and lock acquisition.
- [x] Thread profile through session context, shared daemon context, daemon
  client, daemon manager, and daemon server.
- [x] Update dispatch so explicit `--profile` uses the corresponding daemon and
  inline fallback pauses only that profile daemon.
- [x] Update CLI daemon/serve commands, login auto-start, doctor checks, and
  profile status to use selected profile state and diagnostics.
- [x] Update deterministic tests for paths, profile status, doctor, and daemon
  profile plumbing.
- [x] Update durable docs and regenerate generated context.
- [x] Run focused and final verification, review diff, and record results.

## Verification

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm agent-context`
- `pnpm docs-check`
- `pnpm agent-map-check`
- `pnpm agent-verify`

## Decisions

- 2026-06-16: Use one daemon process per profile instead of one daemon managing
  many browser contexts, matching the request and current daemon architecture.
- 2026-06-16: Keep `checkout-confirm` daemon-blocked; profile daemon support
  does not weaken checkout safety.
- 2026-06-16: Use deterministic local verification only; live 1688 browser
  checks require user/session state and are out of scope for automated tests.

## Progress Log

- 2026-06-16: `/to-done` readiness path selected: clear complex request with no
  existing matching durable spec or active plan, so create full spec and full
  active ExecPlan before implementation.
- 2026-06-16: `/run` execution strategy selected. Goal tracking preference:
  prefer Codex /goal. Goal tracking result: Codex /goal. Delegation: none.
  Reason: the active plan has one objective, scoped non-goals, deterministic
  verification, and an adaptive validation loop. Subagents skipped because the
  core daemon/session files are tightly coupled and should be edited/reviewed
  by the primary agent. Completed checklist item: durable spec/index and active
  ExecPlan created.
- 2026-06-16: Implemented profile-scoped runtime helpers for socket, pid,
  version, log, state, and lock artifacts. Default artifacts remain compatible
  at the historical root paths; non-default profiles use their profile runtime
  directory. Windows daemon pipes now include a profile hash.
- 2026-06-16: Threaded profile through locks, inline sessions, shared daemon
  browser context, daemon client/manager/server, dispatch, login auto-start,
  doctor, profile status, whoami state writes, seller/inbox state reads, and
  checkout-confirm daemon pause/resume.
- 2026-06-16: Updated durable docs (`ARCHITECTURE.md`, `docs/COMMANDS.md`,
  `docs/JSON_CONTRACTS.md`, `docs/RELIABILITY.md`, `docs/SAFETY.md`,
  `docs/QUALITY_SCORE.md`) and refreshed generated context with
  `pnpm agent-context`.
- 2026-06-16: Review result: diff stayed within the profile daemon spec and
  plan; checkout confirmation remains daemon-blocked and approval behavior is
  unchanged. A small doctor indentation/readability issue found during diff
  review was fixed before final verification.
- 2026-06-16: Verification passed:
  `pnpm typecheck`;
  `pnpm vitest run tests/paths.test.ts tests/state.test.ts tests/profile.test.ts tests/doctor.test.ts --exclude tests/doctor-live.test.ts`;
  `pnpm test:unit`;
  `pnpm agent-context`;
  `pnpm agent-verify`.
  Final `pnpm agent-verify` passed with 27 test files and 174 deterministic
  tests, fresh generated context, passing agent-map check, and passing release
  check. No blockers or new open questions remain.

## Rollback

Revert the profile daemon changes in `src/session`, `src/daemon`,
`src/commands`, `src/cli.ts`, tests, and docs. Existing profile browser data
under `~/.1688/profiles/<name>` is not modified by rollback.
