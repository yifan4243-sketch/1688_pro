# Sourcing Research

This spec defines the first durable sourcing-research layer for `1688-cli`.
It turns search results into procurement decisions while preserving the CLI's
buyer-workflow identity: human-paced, logged-in, safe for a real account, and
agent-friendly JSON.

## Goal

Help an agent or buyer answer:

- Which offers have demand?
- Which suppliers look trustworthy?
- Which offers are cheap enough for the target range?
- Which offers deserve detail-page enrichment?
- Which offer IDs should be compared before inquiry/cart/checkout?

## Non-Goals

- Do not build a bulk scraping farm.
- Do not bypass login, risk control, or slider verification.
- Do not add multi-account orchestration.
- Do not claim supplier scores, repurchase rate, or service guarantees unless
  the current 1688 payload exposes them reliably.
- Do not make ordinary `search` slow by fetching every detail page.

## Commands

### `search`

Add research-oriented read-only controls to ordinary keyword search:

```bash
1688 search <keyword> \
  --sort relevance|best-selling|price-asc|price-desc \
  --price-min 1 \
  --price-max 50 \
  --province 广东 \
  --city 深圳 \
  --verified any|factory|business|super-factory \
  --min-turnover 100 \
  --exclude-ads
```

`search` remains fast. Filters and local sort apply to the collected result
set. Remote sort parameters may be added to the search URL when known, but the
command must still locally normalize output ordering for deterministic agent
behavior.

### `research`

Add a multi-keyword research command:

```bash
1688 research <keyword...> \
  --max-per-query 60 \
  --sort best-selling \
  --price-max 50 \
  --verified super-factory \
  --enrich top:10 \
  --jsonl
```

`research` runs keyword searches one by one, applies the same filters, scores
offers, deduplicates by `offerId`, and optionally enriches only the top N
results by calling `offer`.

Supported export modes:

- default: human table
- JSON: normal automatic JSON when stdout is piped or `--json` is used
- `--jsonl`: one research item per line
- `--csv`: comma-separated table
- optional `--output <file>`: write export to a file

### `compare`

Add a read-only offer comparison command:

```bash
1688 compare <offerId...>
```

It fetches each offer detail, computes comparable fields and a sourcing score,
and shows price, MOQ, sale count, SKU count, stock, supplier, freight/package
hints, and detail fetch errors.

### `supplier inspect`

Supplier-level inspection now lives in
[`supplier-inspect.md`](supplier-inspect.md). V1 supports offerId, offer URL,
`b2b-*` memberId, and factory-card URL. Direct loginId lookup remains out of
scope because live probing showed it can resolve to the wrong factory.

### `supplier search` / `supplier research`

Supplier discovery from 1688's company search is specified separately in
[`supplier-search.md`](supplier-search.md). These commands must use company
search payloads and must not build supplier lists by aggregating offer-search
results.

## Data Model

### Search Item

Each `search` offer may include the existing fields plus additive research
signals:

```ts
{
  offerId: string,
  title: string,
  price: { text: string, min: number | null, max: number | null },
  supplier: { name: string | null, shopUrl: string | null, years: number | null },
  verified: { factory: boolean, business: boolean, superFactory: boolean },
  tags: string[],
  isP4P: boolean,
  turnover: string | null,
  demand?: {
    orderCountText: string | null,
    orderCount: number | null,
    repurchaseRateText: string | null,
    repurchaseRate: number | null,
  },
  serviceTags?: string[],
  productBadges?: string[],
}
```

### Research Item

```ts
{
  sourceKeyword: string,
  sourceRank: number,
  globalRank: number,
  offer: Offer,
  demand: {
    turnoverText: string | null,
    orderCount: number | null,
    repurchaseRate: number | null,
  },
  supplier: {
    years: number | null,
    verified: Offer["verified"],
    tags: string[],
    isAd: boolean,
  },
  score: number,
  scoreBreakdown: Array<{ name: string, points: number, reason: string }>,
  enriched?: OfferDetailSummary,
  error?: { code: string, message: string },
}
```

## Sourcing Score V1

The score is explainable and bounded to 100.

- Price: up to 25 points for a valid low price.
- Demand: up to 25 points from turnover/order count.
- Supplier tenure: up to 15 points from shop years.
- Verification: up to 15 points for super factory, factory, or business
  verification.
- Service tags: up to 10 points from tags/service badges.
- Organic result: up to 10 points when the offer is not P4P/ad.

The score is a ranking aid, not a truth claim.

## Failure Semantics

For `research` and `compare`, distinguish:

- run-level failure: login expired, risk control, browser/network failure that
  prevents the command from continuing.
- item-level failure: one offer detail fails during enrichment or comparison.

Item-level failures stay attached to the item and should not fail the whole
run unless every item fails.

## Verification

- Unit tests cover sorting, filters, score calculation, export formatting, and
  enrichment option parsing.
- `pnpm agent-context` refreshes generated command and JSON-shape indexes.
- `pnpm agent-verify` is the default gate.
