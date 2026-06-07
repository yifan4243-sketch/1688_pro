# Checkout And Orders

Checkout and order tracking commands operate real buyer state.

## Commands

```bash
1688 checkout prepare <cartIds...>
1688 checkout confirm <cartIds...>
1688 order list [--status <status>]
1688 order get <orderId>
1688 order logistics <orderId>
1688 shipped <orderId>
1688 stuck [--days N]
1688 fake-shipped [--days N]
1688 seller-history <sellerName>
```

## Checkout Boundary

`checkout prepare` is read-only. `checkout confirm` places a real order and
must follow the protocol in `docs/SAFETY.md`.

## Agent Requirements

- Preserve order IDs, seller identity, totals, line items, services, badges,
  actions, and logistics trace fields.
- Keep overdue/fake-shipped workflows explainable: include thresholds and the
  evidence used to flag each order.
- Never hide partial scans; report scan limits and blockers.
