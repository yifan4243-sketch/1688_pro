# Plan: Ozon RFBS Automatic Pricing And Offer IDs

## Goal

Generate stable Ozon offer IDs from the source 1688 Offer ID and calculate an
auditable CNY listing price for every SKU after Ozon category selection and
before the draft becomes ready. Commission must come from the supplied RFBS
category table and shipping must come from the supplied CEL tariff table.

## Constraints

- Work on `codex`; do not merge to `main`.
- Never submit a real Ozon listing during implementation or verification.
- Never fall back to the 1688 purchase price when pricing cannot be completed.
- Match commission by the exact Russian main-category/category/product-type
  tuple resolved from `description_category_id + type_id`.
- Preserve existing IPC methods and add fields compatibly.

## Progress

- [x] Inspected the old extension formula and both supplied workbooks.
- [x] Confirmed the commission workbook contains 9,308 unique full category
  tuples and that leaf-name-only matching is unsafe.
- [x] Generated versioned commission and CEL data snapshots with source hashes.
- [x] Implemented offer IDs and the automatic pricing engine.
- [x] Added persisted pricing settings and editor diagnostics.
- [x] Added regression tests and updated durable documentation.
- [x] Ran `pnpm agent-context`, `pnpm agent-verify`, renderer checks and desktop
  build; record exact results.

## Decisions

- General RFBS commission is column M; the special motorcycle column is out of
  scope.
- Platform fee is fixed at 1% of listing price.
- Defaults are 10% other fees, 20% profit on purchase cost, CNY 2 label fee,
  Economy, and pickup-point handoff. Customers can change every default except
  platform fee and category-derived commission.
- The old extension's CNY price bands (135 / 635 / 22,525) remain the CEL band
  boundaries. No live FX dependency is introduced.
- Final price is rounded upward to CNY cents so rounding cannot reduce the
  achieved profit below the configured target.
- Pricing supports CNY stores only. Other store currencies fail closed with a
  precise diagnostic.

## Verification Log

- `pnpm vitest run tests/ozon-pricing.test.ts tests/ozon-settings.test.ts`:
  passed (pricing/settings targeted suite).
- `pnpm vitest run tests/ozon-draft.test.ts`: passed (45 tests).
- Workbook extraction validation: 9,308 commission rows, 9,308 unique exact
  paths, six CEL groups, 18 CEL rates; mousepad source row 8,184 = RFBS 50%.
- `pnpm renderer:typecheck`: passed after the final editor changes.
- `pnpm desktop:build`: passed; Vite production renderer built successfully.
- `npm pack --dry-run --json`: confirmed the pricing engine and both versioned
  data snapshots are present in the publication manifest.
- `pnpm agent-context`: passed; generated indexes updated.
- Final `pnpm agent-verify`: passed, including typecheck, all 385 deterministic
  tests across 38 files, fresh-doc checks, agent-map checks, and release checks.
