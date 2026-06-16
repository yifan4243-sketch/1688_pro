# Workflow

This is the default workflow for AI agents and humans working in this
repository. Keep it executable and linked to deeper docs.

## Operating Model

- Humans set intent, constraints, priorities, and approval boundaries.
- Agents read the map, choose the smallest coherent slice, implement, verify,
  and update durable docs.
- `AGENTS.md` is the fast entry point; this file is the default operating loop.
- Playbooks under `docs/playbooks/` hold repeatable task details.
- ExecPlans under `docs/exec-plans/` hold long-running state that should
  survive chat history loss.

## Standard Task Brief

Capture or infer these fields before changing code:

```md
Goal:
Context:
Constraints:
Done when:
```

Ask the human only when the missing choice changes product behavior, checkout
safety, data retention, account security, or external write actions.

## New Feature Flow

1. Read `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, and the relevant
   product spec or playbook.
2. Locate the owning command/session/daemon/io layer.
3. For complex work, create or update an ExecPlan in
   `docs/exec-plans/active/`.
4. Implement one bounded slice that can be verified independently.
5. Add or update deterministic tests near the changed code.
6. Update durable docs when command behavior, JSON output, safety rules, or
   recurring workflow guidance changes.
7. Run the smallest verification ladder that proves the change, then climb if
   risk increases.

## Bugfix Flow

1. Reproduce or narrow the failure with a test, probe, fixture, saved artifact,
   or captured browser response.
2. Locate the smallest owning layer: CLI, command, session, daemon, io, auth,
   or util.
3. Fix the root cause with minimal unrelated churn.
4. Add a regression test or document why one is not practical.
5. Run a focused test first, then `pnpm agent-verify` when the blast radius
   warrants it.

## Verification Ladder

1. Focused checks: a single Vitest file, typecheck, or generated-context run.
2. Deterministic test gate: `pnpm test:unit`.
3. Agent gate: `pnpm agent-context`, then `pnpm agent-verify`.
4. Browser/live checks: `pnpm test` or manual/probe-based verification only
   when the task touches real 1688 browser behavior and the user/session state
   allows it.

## Release Flow

Use `docs/playbooks/update-cli-release.md` for release details. By project
policy, agents may prepare the release, commit, tag, push, and create the
GitHub release, but npm publishing is a human-owned step.

For npm, the agent first checks the human's npm login state:

```bash
npm whoami --registry https://registry.npmjs.org/
```

If the check succeeds, provide this command:

```bash
npm publish --registry https://registry.npmjs.org/
```

If the check fails, provide these commands:

```bash
npm login --registry https://registry.npmjs.org/
npm publish --registry https://registry.npmjs.org/
```

Let npm handle any required interactive authentication or confirmation. Do not
include `--otp`. `--access public` is not required for the unscoped
`1688-cli` package.

Do not run `npm publish` from an agent session, even when npm auth is present.

## Human Approval Boundaries

Ask before doing any of these:

- Placing an order or using `checkout confirm --agent`.
- Logging out or forcing a login reset.
- Submitting a public GitHub issue with `feedback --submit`.
- Sending a real seller chat/inquiry unless the user asked for that specific
  message to be sent.
- Running live/browser actions that can mutate cart, checkout, seller IM, or
  account state.
- Making a breaking JSON contract change.
- Publishing to npm. Give the human the command instead.

## Definition Of Done

- The change is implemented in the owning layer.
- Tests cover the behavior or the reason for no test is recorded.
- Relevant docs/specs/playbooks/generated indexes are updated.
- `pnpm agent-verify` passes, or the exact blocker is recorded.
