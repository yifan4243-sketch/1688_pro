# Playbook: Amazon FBA Sourcing From 1688

Use this playbook when an agent or operator uses `1688-cli` to research suppliers for an Amazon FBA product decision.

The goal is not to auto-buy. The goal is to turn 1688 search and supplier signals into a safer sourcing decision: shortlist, ask, sample, negotiate, or stop.

## 1. Start With The Amazon Constraint

Capture the selling-side constraints before searching 1688:

- Target Amazon marketplace and category.
- Target selling price and acceptable landed cost.
- FBA size and weight constraints.
- Compliance, labeling, packaging, and claim restrictions.
- First test quantity, cash budget, and latest launch date.
- Must-have product requirements and non-goals.

If these are unknown, keep the output as a research shortlist instead of a purchase recommendation.

## 2. Build The Offer Dataset

Use product research when the decision starts from a product idea or keyword:

```bash
1688 research "coffee capsule holder" --max-per-query 50 --enrich top:5 --csv
1688 search "coffee capsule holder" --sort best-selling --max 20 --exclude-ads
1688 compare <offerIdA> <offerIdB> <offerIdC>
```

For each offer, capture:

- Price tiers and MOQ.
- SKU breadth and customization options.
- Package dimensions and weight when visible.
- Recent sales or repeat buyer signals when available.
- Images, materials, and product attributes.
- Supplier identity and service signals.

## 3. Build The Supplier Shortlist

Use supplier research when factory quality matters more than one low-price offer:

```bash
1688 supplier search "coffee capsule holder" --factory-only --max 20
1688 supplier research "coffee capsule holder" --enrich top:5 --csv
1688 supplier inspect <offerId-or-memberId>
```

Shortlist suppliers that pass most of these checks:

| Check | Prefer | Avoid |
| --- | --- | --- |
| Factory identity | Factory or manufacturer signals are clear | Trading identity is unclear for a custom product |
| MOQ fit | Test quantity is possible | MOQ forces too much first-order cash |
| Price tiers | Price still works after freight, FBA, returns, and ads | Margin works only at unrealistic volume |
| Communication | Supplier can answer packaging, logo, sample, and lead-time questions | Supplier avoids concrete answers |
| Product fit | Materials, dimensions, and packaging match the Amazon plan | Listing claims or materials create compliance risk |
| Quality risk | Sample, QC, and defect handling can be discussed | No clear sample or after-sale path |

## 4. Ask Before Cart Or Checkout

Before mutating cart state or placing an order, ask suppliers concrete questions:

```bash
1688 seller inquire <offerId> "Can you provide sample cost, MOQ, lead time, package size, gross weight, customization options, and whether the product can use neutral packaging for Amazon FBA?"
1688 seller messages --offer <offerId> --watch
```

Useful questions:

- What is the sample price and shipping method?
- What are the exact carton dimensions and gross weight?
- Can the product use neutral packaging, FNSKU labels, and carton labels?
- What is the production lead time for the test order and reorder?
- What customization is available for logo, color, material, or bundle?
- What defect policy applies after receiving goods?
- Are any certificates, test reports, or material documents available?

## 5. Convert 1688 Signals Into An Amazon Decision

Do not recommend checkout from 1688 data alone. Convert the shortlist into one of these decisions:

- `Sample`: supplier and economics look plausible; order samples only.
- `Ask More`: product is interesting but packaging, lead time, MOQ, or compliance is unclear.
- `Negotiate`: supplier fits, but MOQ, price tier, packaging, or sample cost needs improvement.
- `Reject`: margin, quality, compliance, communication, or cash risk is unacceptable.

Output format:

| Supplier / Offer | Decision | Why | Missing Evidence | Next Action |
| --- | --- | --- | --- | --- |
| Supplier A | Sample | MOQ fits and price tier leaves margin room | Carton size, sample freight | Ask for sample invoice |
| Supplier B | Ask More | Good product match but package data missing | Gross weight, FNSKU support | Send inquiry |

## 6. Safety Rules

- Never run `checkout confirm --agent` without the prepare-preview-approval cycle in `docs/SAFETY.md`.
- Treat payment, order placement, and cart mutation as user-authorized actions only.
- Do not infer Amazon compliance, IP safety, or profitability from supplier claims alone.
- Keep private seller data, supplier quotes, and account screenshots out of public issues and PRs.