# Reliability

`1688-cli` depends on a live website, browser automation, mtop responses, and a
real logged-in buyer session. Reliability work should make failures explicit
and recoverable for agents.

## Daemon

The daemon routes commands through one persistent Chromium context.

Benefits:

- Saves Chrome cold-start time.
- Keeps one continuous logged-in session.
- Adds inter-command jitter.

Use `1688 daemon start` near the beginning of a session with multiple 1688
commands. The daemon auto-stops after inactivity. Run `1688 daemon reload`
after package updates.

`login`, `logout`, and `doctor` stay inline because they need interactive UI,
browser windows, or environment checks.

## Watch Mode

`1688 seller messages ... --watch` is designed to stay alive.

- It prints a baseline line to stderr.
- It emits one JSON object to stdout for each newly-arrived message.
- History is not re-emitted.
- Deduplication uses server-side `messageId` when present.
- It exits cleanly on SIGINT.

Agent loops should parse stdout line by line and should not assume the process
will exit by itself.

## Browser Recovery

Commands should detect and report:

- login redirects
- risk-control / slider pages
- closed browser windows
- empty mtop captures
- network failures

Use structured `CliError` exit codes so agents can choose the next safe step.

## Probes And Fixtures

Probe scripts under `scripts/probe-*.mjs` are useful for discovering page
behavior, selectors, and mtop payloads. They are not stable automated tests.

Stable behavior belongs in `tests/` with fixtures where possible.

## Live-Service Boundaries

`pnpm test:unit` is the deterministic default. `pnpm test` also runs live
doctor checks and may depend on local browser/session state. Browser or
account-mutating checks should be explicit, bounded, and documented in the
final response when they cannot be run.
