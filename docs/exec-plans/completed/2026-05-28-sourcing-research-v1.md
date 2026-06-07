# Plan: Sourcing Research V1

## Goal

Deliver a complete first version of sourcing research:

- `search` supports research sort/filter flags.
- `research` runs multi-keyword sourcing research with scoring, dedupe,
  export, and optional top-N enrichment.
- `compare` compares offer detail pages by sourcing-relevant fields.
- Docs, JSON contracts, generated indexes, and tests are updated.

## Context

- Spec: `docs/specs/sourcing-research.md`
- Backlog: `docs/FEATURES.md`
- Existing search command: `src/commands/search.ts`
- Search payload mapping: `src/session/search-mtop.ts`
- Offer detail command: `src/commands/offer.ts`
- CLI routing: `src/cli.ts`
- Output behavior: `src/io/output.ts`
- Agent rules: `docs/AGENT_WORKING_PRINCIPLES.md`

## Non-Goals

- Do not implement `supplier inspect` until reliable supplier-level payloads
  are identified.
- Do not scrape every search result detail page by default.
- Do not change checkout/cart/seller-message behavior.
- Do not introduce remote writes.

## Design

1. Extend `search` with:
   - `--sort`
   - `--price-min`
   - `--price-max`
   - `--province`
   - `--city`
   - `--verified`
   - `--min-turnover`
   - `--exclude-ads`

   Search remains one fast read-only command. Filtering and deterministic sort
   happen locally on the collected result set. The search URL may include known
   remote sort values, but local sorting remains the contract.

2. Add shared sourcing helpers:
   - normalize sort/filter options
   - parse turnover/order-count text
   - score offers and offer details
   - format JSONL/CSV exports

3. Add `research`:
   - runs searches sequentially through existing daemon dispatch
   - dedupes by offerId
   - computes score/breakdown
   - optionally enriches top N items through `offer`
   - emits normal JSON/human output or explicit JSONL/CSV

4. Add `compare`:
   - validates offer IDs
   - fetches offer details sequentially
   - returns item-level errors
   - scores and sorts comparable summaries

5. Update docs and generated context.

## Self Review

- Risk: `sortType` URL behavior may vary by 1688 page version.
  - Mitigation: keep local deterministic sorting as the public contract.
- Risk: supplier scores and repurchase rate may not exist in current payloads.
  - Mitigation: include nullable fields and do not claim them as available.
- Risk: enrichment can trigger more browser/detail-page work.
  - Mitigation: default enrichment to 0; require `--enrich top:N`.
- Risk: CSV/JSONL could bypass global output flags.
  - Mitigation: explicit `--jsonl`/`--csv` modes only for `research`, with
    validation against simultaneous use.
- Risk: item-level offer failures could abort useful research output.
  - Mitigation: attach item errors and keep run output when at least one item
    succeeds.

## Milestones

- [x] Expand spec and plan.
- [x] Implement search sort/filter helpers and flags.
- [x] Implement sourcing helper/scoring/export module.
- [x] Implement `research`.
- [x] Implement `compare`.
- [x] Add focused tests.
- [x] Update docs/backlog.
- [x] Run `pnpm agent-verify`.

## Verification

```bash
pnpm test:unit
pnpm agent-context
pnpm agent-verify
```

## Decisions

- 2026-05-28: Keep `supplier inspect` out of V1 because reliable supplier-level
  payloads are not yet mapped.
- 2026-05-28: Use local deterministic sorting/filtering as the contract even
  when adding remote sort URL params.
- 2026-05-28: Enrichment defaults to off; top-N enrichment is explicit.

## Progress Log

- 2026-05-28: Created spec and plan. Self-review identified remote sort,
  supplier-score availability, enrichment cost, export-mode validation, and
  item-level failure handling as the main risks.
- 2026-05-28: Implemented `search` sort/filter controls, shared sourcing
  scoring/export helpers, `research`, `compare`, and focused unit tests.
- 2026-05-28: Verification passed: `pnpm test:unit` (22 files, 151 tests),
  `pnpm agent-context`, `pnpm agent-verify`, and `pnpm build`.

## Rollback

- Remove `research` and `compare` CLI entries and command files.
- Revert added `search` flags and helper usage.
- Regenerate agent context.
