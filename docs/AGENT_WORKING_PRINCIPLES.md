# Agent Working Principles

These principles apply to all coding agents working in this repository. The
first half is a reusable baseline shared with other agent-ready repositories;
the second half adds `1688-cli`-specific rules for buyer safety, JSON
contracts, and browser automation.

Tradeoff: these guidelines bias toward caution over speed. For trivial tasks,
use judgment.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State assumptions explicitly when they matter.
- If multiple interpretations exist, present them instead of picking silently.
- If a simpler approach exists, say so.
- Push back when a request conflicts with safety, compatibility, or the repo's
  existing architecture.
- Ask only when the missing answer changes product behavior, account safety,
  checkout/order behavior, data retention, or a breaking contract.

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that was not requested.
- No broad error handling that hides the real failure.
- If the implementation is much larger than the problem, simplify it.

Ask yourself: would a senior engineer say this is overcomplicated? If yes,
rewrite it smaller.

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Do not improve adjacent code, comments, or formatting unless needed.
- Do not refactor unrelated behavior.
- Match existing style, even if you would design it differently.
- If you notice unrelated dead code or risk, mention it; do not delete it.

When your changes create orphans:

- Remove imports, variables, files, and functions that your changes made unused.
- Do not remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" -> write invalid-input tests, then make them pass.
- "Fix the bug" -> reproduce it or narrow it, then make the check pass.
- "Refactor X" -> keep behavior stable and run the relevant gate.
- "Add command" -> implement, document, update generated context, and verify.

For multi-step tasks, use a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let agents loop independently. Weak criteria such as
"make it work" require clarification or a conservative assumption.

## 5. Read The Map First

- Start with `AGENTS.md`, then load only the relevant deeper docs.
- Use `ARCHITECTURE.md` to find the owning layer before changing code.
- Use `docs/generated/*` for fast orientation instead of hand-building stale
  inventories.
- Do not rely on chat history for durable decisions; write important context
  into docs or an ExecPlan.

## 6. Work In Small Verified Slices

- Prefer one bounded change that can be tested independently.
- Run focused checks first, then the default gate when risk warrants it.
- Use `pnpm agent-context` after command, JSON contract, source layout, or test
  layout changes.
- Use `pnpm agent-verify` as the default green gate before handoff.

## 7. Preserve Buyer Safety

- Treat 1688 as a real buyer account with real sellers, cart state, orders, and
  session risk controls.
- Never place an order without the prepare plus current-turn approval protocol.
- Never send seller messages unless the user requested the specific send or
  approved the exact message.
- Do not force logout, force login reset, or global package upgrades without
  explicit current-turn approval.
- Login and slider/risk-control flows require the user; do not silently loop.

## 8. Protect JSON Contracts

- Agent-facing JSON is part of the product surface.
- Prefer additive fields over renamed or removed fields.
- Keep `--json`, `--get`, `--pick`, and watch-mode line-delimited JSON stable.
- Update `docs/JSON_CONTRACTS.md` when output shape changes.
- Add tests or fixtures when parser changes affect stable JSON.

## 9. Make Failures Inspectable

- Preserve `requestId`, `errorCode`, `pageState`, `verification`, and
  `artifactDir` when browser/session flows fail.
- Use `1688 debug list`, `1688 debug last`, and `1688 debug show <requestId>`
  to inspect recent command events.
- Do not hide failures by broad retry loops or vague error messages.
- Record exact command and failure summary in ExecPlans or final responses when
  verification cannot pass.
- Distinguish system-level failure from item-level failure in batch workflows.

## 10. Browser Automation Discipline

- Prefer mtop/structured payload parsing over fragile DOM scraping.
- Keep locator changes scoped and add fixture-backed tests where practical.
- Use `--headed` as the manual escape hatch for slider verification.
- Probe scripts are for discovery; stable behavior belongs in `src/`, `tests/`,
  and docs.
- Avoid aggressive bulk scraping patterns that increase WAF/risk-control
  exposure.

## 11. Documentation Discipline

- Update command docs when command names, flags, examples, or behavior change.
- Update safety docs when write actions or approval boundaries change.
- Promote repeated debugging steps into playbooks.
- Keep feature ideas in `docs/FEATURES.md` and long-running work in
  `docs/exec-plans/`.
- Keep `AGENTS.md` short; move durable detail into `docs/`.

