# Supplier Search And Research

This spec defines supplier discovery that starts from 1688's company search,
not product-offer aggregation.

## Goal

Help a buyer or agent answer:

- Which suppliers match this category keyword?
- Which matching suppliers expose factory/trust/service signals?
- Which suppliers deserve deeper `supplier inspect` enrichment?
- Which suppliers should be contacted or compared after product discovery?

## Source Boundary

`supplier search` and `supplier research` must use 1688 company search. The
known durable business endpoint from live probing is:

```text
search.1688.com/service/companySearchBusinessService
```

The page entry URL is:

```text
https://s.1688.com/company/company_search.htm?keywords=<GBK-percent-keyword>
```

Important encoding rule: `s.1688.com` expects GBK percent-encoded keywords.
UTF-8 percent-encoding can search for mojibake and return zero or irrelevant
results.

Do not implement supplier discovery by running offer search and grouping
offers by supplier. That is a different signal and can hide suppliers that are
available in company search.

## Commands

### `supplier search`

```bash
1688 supplier search <keyword...> \
  --max 20 \
  --factory-only \
  --province 广东 \
  --city 深圳 \
  --min-years 3 \
  --min-repeat-rate 0.4 \
  --min-response-rate 0.6 \
  --enrich 0
```

Default behavior is supplier discovery only. `--enrich` is optional and
defaults to `0`.

### `supplier research`

```bash
1688 supplier research <keyword...> \
  --max 20 \
  --factory-only \
  --enrich top:10 \
  --jsonl
```

`supplier research` uses the same company-search source and scoring, but
defaults to `--enrich top:10`. Enrichment calls `supplier inspect` with the
company-search `memberId` when present.

Supported export modes:

- default: human table
- JSON: automatic when stdout is piped or `--json` is used
- `--jsonl`: one supplier item per line
- `--csv`: comma-separated table
- `--output <file>`: write JSONL/CSV to a file

## Data Model

Each item records source keyword/rank, normalized company-search supplier
signals, score, and optional inspect enrichment:

```ts
{
  sourceKeyword: string,
  sourceRank: number,
  globalRank: number,
  supplier: {
    companyName: string,
    loginId: string | null,
    memberId: string | null,
    enterpriseId: string | null,
    realUserId: string | null,
    companyId: string | null,
    shopUrl: string | null,
    factoryCardUrl: string | null,
    location: { province: string | null, city: string | null, address: string | null },
    productionService: string | null,
    tp: { serviceYears: number | null, memberLevel: string | null },
    factory: {
      isFactory: boolean,
      factoryTag: string | null,
      factoryLevel: string | null,
      superFactory: boolean,
      businessInspection: boolean,
      factoryInspection: boolean,
    },
    service: {
      compositeScore: number | null,
      wwResponseRate: number | null,
      repeatRate: number | null,
    },
    demand: {
      payOrderCount3m: number | null,
      payAmount3m: number | null,
      fuzzyPayAmount3m: string | null,
      saleQuantity3m: number | null,
    },
    tags: string[],
    offersPreview: SupplierOfferPreview[],
  },
  score: number,
  scoreBreakdown: Array<{ name: string, points: number, reason: string }>,
  inspect?: SupplierInspectResult,
  error?: { code: string, message: string },
}
```

The top-level result includes:

```ts
source: {
  kind: "company-search",
  endpoint: "companySearchBusinessService",
  offerAggregation: false,
}
```

## Score V1

The supplier score is a ranking aid, not a truth claim.

- Company-search demand: up to 25 points from 3-month pay order count.
- Supplier tenure: up to 15 points from service years.
- Factory/trust: up to 20 points from factory/super-factory/inspection flags.
- Service rates: up to 15 points from repeat and Wangwang response rates.
- Composite score: up to 10 points.
- Offer preview depth: up to 10 points from company-search previews.

## Failure Semantics

- Run-level failure: login expired, risk control, browser/network failure that
  prevents company search from loading.
- Empty result: company search loads but returns no supplier payload.
- Item-level enrichment failure: `supplier inspect` fails for one supplier;
  keep the supplier item and attach `error`.

If a command exits with risk-control code `4`, retry once with `--headed` and
solve the slider manually.

## V1 Boundaries

Live probing on 2026-06-04 showed the company search page emits
`companySearchBusinessService` with `companyWithOfferLists`. A typical first
page async response used `startIndex=6&asyncCount=14`; this likely means some
top-page suppliers may be server-rendered before the async service response.
V1 uses the stable browser-emitted business response and keeps the largest
captured company-search payload. A later V2 can add HTML/DOM extraction for
server-rendered supplier cards if we need exact 20-per-page completeness.

## Verification

- Unit tests cover GBK company-search URL construction.
- Unit tests cover `companySearchBusinessService` parsing and offer previews.
- Unit tests cover capture `keep: "largest"` behavior.
- Unit tests cover enrich option parsing and CSV escaping.
- `pnpm agent-context` refreshes generated command and JSON-shape indexes.
- `pnpm agent-verify` is the default gate.
