# Ozon RFBS Automatic Pricing

## Scope

The desktop Ozon workflow calculates a CNY listing price for every selected
1688 SKU after Ozon category resolution and before a draft can become ready.
It prepares a draft only; pricing never authorizes or performs an Ozon import.

## Offer IDs

- A product with one source SKU uses the unmodified 1688 Offer ID.
- A product with multiple source SKUs uses `OfferID-N`, where `N` is the SKU's
  original one-based position in the 1688 response.
- SKU filtering records the original position before filtering. Selecting only
  the second and fourth variants therefore produces `OfferID-2` and
  `OfferID-4`, not a newly renumbered pair.

## Commission Matching

The application loads the Russian Ozon category tree and resolves the selected
`description_category_id + type_id` to its complete path. The final three
Russian path components are matched exactly against main category, category,
and product type in the versioned RFBS data snapshot.

Leaf-name fallback, fuzzy matching, AI matching, and default commissions are
forbidden. A missing exact match triggers one forced Russian tree refresh. If
the refreshed path still has no exact commission row, pricing is unresolved
and every affected price remains `0`.

The commission source is the general RFBS column. The special motorcycle rate
is not used.

## Formula

For each SKU:

```text
target_profit = purchase_cost * target_profit_rate

listing_price =
  (purchase_cost + CEL_shipping + label_fee + target_profit)
  / (1 - RFBS_commission_rate - 0.01 - other_fee_rate)
```

RFBS commission, the fixed 1% platform service fee, and other fees are
percentages of the final listing price. Target profit is a percentage of 1688
purchase cost. The result is rounded upward to two CNY decimals.

CEL shipping uses physical weight and package dimensions. The solver considers
all applicable shipment groups and accepts only a solution whose final CNY
price is consistent with the retained `135 / 635 / 22525` value bands.

## Settings

Defaults:

- other fees: 10%
- target profit: 20% of purchase cost
- label fee: CNY 2
- CEL speed: Economy
- handoff: pickup point

Users may change those five values. The platform fee, currency, RFBS mode, and
data versions are read-only. Settings are persisted in `ozon_settings.json` and
old files without a `pricing` object receive the defaults.

## Failure Contract

Pricing fails closed for unsupported store currency, missing Russian category
path or commission, missing/invalid purchase price, weight or dimensions,
unavailable CEL handoff rate, invalid percentage totals, inconsistent CEL price
bands, or shipment data outside the tariff range.

An unresolved pricing summary has `status: "unresolved"`, structured error
codes and reasons, and `items[].price` set to `"0"`. The draft remains in the
manual-attention state and submit validation rejects it. It never reuses the
1688 purchase price as the Ozon listing price.

## Versioned Data

Published read-only snapshots live under `apps/desktop/pricing-data/` and ship
with the desktop package. Each snapshot records the source file, SHA-256,
source sheet/range, source row numbers, and effective version. The RFBS snapshot
contains 9,308 unique complete paths; the CEL snapshot contains six shipment
groups and 18 speed-rate rows.

## Draft Diagnostics

The additive top-level `pricing` object records:

- status, currency, data versions and settings snapshot;
- Chinese and Russian category paths, exact commission source row and rate;
- per-SKU purchase cost, package data, shipment group and shipping charge;
- RFBS, platform, other, label and target-profit amounts;
- calculated listing price and structured failure diagnostics.

The editor displays this snapshot before product attributes. A manual price
change is still permitted and is visibly marked as an override; the original
automatic pricing snapshot remains available for audit.
