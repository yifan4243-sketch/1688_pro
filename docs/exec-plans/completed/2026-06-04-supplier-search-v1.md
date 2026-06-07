# Supplier Search V1

## Goal

Deliver supplier discovery and research backed by real 1688 company search:

- `1688 supplier search <keyword...>`
- `1688 supplier research <keyword...>`
- source must be `companySearchBusinessService`
- source must not be offer-result supplier aggregation
- optional top-N enrichment through `supplier inspect`

## Context Read

- Agent principles: `docs/AGENT_WORKING_PRINCIPLES.md`
- Sourcing spec: `docs/specs/sourcing-research.md`
- Supplier inspect spec: `docs/specs/supplier-inspect.md`
- New spec: `docs/specs/supplier-search.md`
- Existing search/capture patterns: `src/commands/search.ts`,
  `src/session/search-capture.ts`

## Live Probe Findings

- Company search page:
  `https://s.1688.com/company/company_search.htm?keywords=<GBK>`
- `s.1688.com` keywords must be GBK percent-encoded. UTF-8 encoding produced
  mojibake/zero-result behavior.
- Business endpoint:
  `search.1688.com/service/companySearchBusinessService`
- Payload path:
  `data.data.companyWithOfferLists`
- Sample async response returned 14 suppliers with `pageCount=50` and
  `docsReturn=14`.
- The async URL used `startIndex=6&asyncCount=14`, so V1 records a known
  completeness boundary: stable service parsing first, optional SSR/DOM card
  parsing later if exact first-page completeness is needed.

## Implementation

1. Add shared GBK percent encoder in `src/util/encoding.ts`.
2. Reuse the encoder in product search URL construction.
3. Add `src/session/supplier-search.ts`:
   - request meta reader for `companySearchBusinessService`
   - service payload parser
   - supplier/offer-preview mapper
   - response capture with `keep: "largest"` and settle window
4. Add `src/commands/supplier-search.ts`:
   - `supplier search`
   - `supplier research`
   - scoring, filters, JSONL/CSV exports
   - optional enrich through `supplier inspect`
5. Add CLI and dispatch registry wiring.
6. Add deterministic unit tests.
7. Update README, command catalog, JSON contracts, feature backlog, and specs.
8. Regenerate agent indexes.

## Decisions

- Keep source provenance explicit in JSON:
  `source.offerAggregation=false`.
- `supplier search` defaults to `--enrich 0`.
- `supplier research` defaults to `--enrich top:10`.
- Rate filters accept both fractions and percentages (`0.4` or `40`).
- Enrichment requires `memberId`; missing memberId is an item-level error.
- Do not use direct unauthenticated fetch for company service because it can
  trigger `x5` interstitials; use browser-emitted responses.

## Verification

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm agent-context`
- `pnpm agent-verify`

## Rollback

- Remove supplier search/research CLI entries.
- Remove dispatch registry entry `supplier-search`.
- Remove `src/commands/supplier-search.ts`.
- Remove `src/session/supplier-search.ts`.
- Revert README/docs/spec/test/index updates.
