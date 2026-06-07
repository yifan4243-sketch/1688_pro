# Agent Maps Plan

Date: 2026-05-28

## Sources Reviewed

- OpenAI: <https://openai.com/zh-Hans-CN/index/harness-engineering/>
- Reference repo: `/Users/nobodyjack2050/code/go-backend`

## OpenAI Article Takeaways

The article's core lesson is that agent-first engineering needs maps and
feedback loops more than huge instruction files. The useful pattern is:

- Keep `AGENTS.md` short. It should be a table of contents and routing layer,
  not a full manual.
- Put durable knowledge in versioned repo files, especially `docs/`, because
  knowledge outside the repo is invisible to agents.
- Use progressive disclosure: start agents at a small map, then point them to
  the precise product spec, playbook, architecture note, or generated index.
- Make the app and repo readable to agents: logs, metrics, traces, screenshots,
  DOM state, generated indexes, and reproducible commands should all be
  queryable.
- Encode taste and architecture as mechanical checks where possible. Guidance
  that matters repeatedly should become lint, tests, generated docs checks, or
  verification commands.
- Treat plans as first-class repo artifacts for complex work so progress,
  decisions, and blockers survive conversation loss.
- Add recurring cleanup. As agent throughput rises, drift becomes normal unless
  quality rules and doc-gardening are part of the system.

## go-backend Agent Map Pattern

`go-backend` implements this pattern with several concrete artifacts:

- `AGENTS.md`: short "Agent Map" with first-read links, project shape, common
  commands, task routing, hard rules, and done criteria.
- `ARCHITECTURE.md`: system map with layer responsibilities, dependency rules,
  major domains, generated code rules, and verification surfaces.
- `docs/README.md`: documentation map and maintenance rules.
- `docs/specs`, `docs/design-docs`, `docs/integrations`,
  `docs/playbooks`, `docs/references`: durable context split by use.
- `docs/exec-plans/active` and `docs/exec-plans/completed`: long-running
  state for complex work.
- `docs/generated/*`: generated repo indexes such as API, proto, DB schema,
  package map, test index, and OpenAPI summary.
- `scripts/generate_agent_context.sh`: builds generated indexes.
- `make agent-context`, `make agent-verify`, `make eval-agent`: standard
  commands for regenerating context and proving agent-readiness.
- `docs/evals/graders/agent-map.sh`: deterministic check that the map exists
  and points to verification/playbooks.
- `docs/QUALITY_SCORE.md`: blunt scorecard for agent-readiness and known gaps.

The important design choice is not the exact file names. It is the loop:
small map -> routed docs -> generated indexes -> mechanical verification ->
quality score -> cleanup.

## Proposed Agent Maps For 1688-cli

`1688-cli` should use a smaller version of the same system. This repo is a
TypeScript CLI with browser automation, daemon IPC, JSON contracts, and real
buyer write actions, so the map should emphasize command ownership, output
shape stability, risk-control recovery, and approval boundaries.

### Target Structure

```text
AGENTS.md
ARCHITECTURE.md
docs/
  README.md
  WORKFLOW.md
  COMMANDS.md
  JSON_CONTRACTS.md
  SAFETY.md
  RELIABILITY.md
  QUALITY_SCORE.md
  specs/
    sourcing-research.md
    seller-im.md
    checkout-and-orders.md
  playbooks/
    add-command.md
    change-json-output.md
    debug-risk-control.md
    add-mtop-capture.md
    update-cli-release.md
  generated/
    command-index.md
    module-map.md
    test-index.md
    json-shapes.md
  exec-plans/
    active/
    completed/
    tech-debt-tracker.md
scripts/
  generate_agent_context.mjs
  check_agent_map.mjs
```

### `AGENTS.md` Target Role

Keep only the short, high-signal contract:

- First read: `ARCHITECTURE.md`, `docs/README.md`, `docs/SAFETY.md`,
  `docs/COMMANDS.md`, and `docs/JSON_CONTRACTS.md`.
- Project shape: `src/commands`, `src/session`, `src/daemon`, `src/io`,
  `src/auth`, `src/util`.
- Common commands: `pnpm build`, `pnpm test`, `pnpm typecheck`, future
  `pnpm agent-context`, future `pnpm agent-verify`.
- Task routing: new command, JSON shape change, browser/session flow,
  daemon/protocol change, checkout/order safety, seller IM, release/update.
- Hard rules: never place orders without prepare plus current-turn approval,
  never silently retry login/risk-control loops, preserve JSON compatibility,
  do not handwave browser verification failures.

The current detailed CLI operation contract can move into `docs/COMMANDS.md`,
`docs/JSON_CONTRACTS.md`, and `docs/SAFETY.md`.

### Generated Context

`scripts/generate_agent_context.mjs` should generate:

- `docs/generated/command-index.md`: Commander commands/options from
  `src/cli.ts`, mapped to `src/commands/*.ts`.
- `docs/generated/module-map.md`: top-level source directories and file counts.
- `docs/generated/test-index.md`: test files, if present, plus risk notes for
  browser/session/integration-style tests.
- `docs/generated/json-shapes.md`: exported result interfaces from command
  modules, especially stable agent-facing payloads.

This gives agents a fast way to understand the repo without reading every file.

### Verification Gate

Add scripts/Make targets roughly equivalent to:

```bash
pnpm agent-context   # generate docs/generated/*
pnpm agent-verify    # typecheck, tests, generated docs freshness, agent map check
pnpm eval-agent      # deterministic repo-specific graders, later
```

Initial `agent-verify` can stay modest:

- `pnpm typecheck`
- `pnpm test`
- generate context and fail if `docs/generated/*` changes
- check that `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, and core
  playbooks exist

### Rollout Order

1. Add `docs/README.md`, `ARCHITECTURE.md`, `docs/COMMANDS.md`,
   `docs/JSON_CONTRACTS.md`, `docs/SAFETY.md`, and `docs/WORKFLOW.md`.
2. Move durable detail out of `AGENTS.md`, keeping `AGENTS.md` as a concise
   routing map.
3. Add `scripts/generate_agent_context.mjs` and generated indexes.
4. Add `agent-context` and `agent-verify` package scripts.
5. Add playbooks for the workflows that repeat most often.
6. Add `QUALITY_SCORE.md` and update it whenever the map reveals a new gap.

## Open Questions

- Whether to preserve the current long `AGENTS.md` for external skill registry
  compatibility, or split it while keeping a compact compatibility section.
- Whether generated JSON-shape docs should parse TypeScript AST or start with a
  simple regex-based extractor.
- Whether browser/risk-control verification should be part of the default gate
  or a separate live/manual gate.
