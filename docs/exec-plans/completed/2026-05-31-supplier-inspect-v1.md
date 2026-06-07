# Plan: Supplier Inspect V1

## Goal

Deliver a read-only supplier inspection command backed by real 1688 payloads:

- `1688 supplier inspect <offerId|memberId|offerUrl|factoryCardUrl>`
- offerId path resolves supplier identity from offer detail and shopcard
- memberId path resolves factory-card data
- JSON contract and human output are documented
- loginId-only input is rejected until a deterministic resolver exists

## Context

- Spec: `docs/specs/supplier-inspect.md`
- Existing offer detail extraction: `src/commands/offer.ts`
- CLI routing: `src/cli.ts`
- Session dispatch: `src/session/dispatch.ts`
- Response parsing: `src/session/mtop.ts`
- Recovery behavior: `src/session/recovery.ts`
- Sourcing helpers/tests: `src/commands/sourcing-utils.ts`,
  `tests/sourcing-utils.test.ts`

## Non-Goals

- Do not add write actions.
- Do not bulk crawl a supplier catalog.
- Do not silently resolve loginId by an unreliable URL.
- Do not change checkout/cart/seller-message behavior.

## Design

1. Add `src/commands/supplier-inspect.ts`.
   - Normalize target into offerId or memberId.
   - Reject loginId-only targets with `BAD_INPUT`.
   - Use `withRecovery` for page-level failures.

2. OfferId path:
   - Open `https://detail.1688.com/offer/<offerId>.html`.
   - Capture `mtop.1688.moga.pc.shopcard`.
   - Read `sellerModel` from `window.context`.
   - If a memberId is found, enrich with factory card.

3. MemberId path:
   - Open `https://sale.1688.com/factory/card.html?memberId=<memberId>`.
   - Capture `mtop.com.alibaba.china.factory.card.common.fn.mtop.tpp.faas`.
   - Parse visible factory-card text for available offer count.

4. Output:
   - Normal human summary lists supplier identity, factory/authentication tags,
     service scores, location, and offer count.
   - JSON output follows the spec and remains nullable/additive.

5. Verification:
   - Add focused unit tests for target normalization and data assembly.
   - Run `pnpm typecheck`, `pnpm test:unit`, `pnpm agent-context`, and
     `pnpm agent-map-check`.
   - Run one live smoke command if session and risk-control state allow.

## Self Review

- Risk: factory card endpoint can time out or not fire.
  - Mitigation: return partial supplier identity with a warning when offerId
    data exists but factory-card enrichment fails.
- Risk: service score key names are not self-explanatory.
  - Mitigation: keep raw keys and add best-effort labels.
- Risk: loginId direct lookup may return the wrong supplier.
  - Mitigation: reject loginId-only input and document the limitation.
- Risk: available offer count only appears in rendered text.
  - Mitigation: mark source as `factory-card-dom` and keep nullable.

## Milestones

- [x] Write spec and plan.
- [x] Implement command, parser, and CLI routing.
- [x] Add focused tests.
- [x] Update README, command catalog, JSON contracts, and feature backlog.
- [x] Regenerate agent context.
- [x] Run verification.

## Verification

```bash
pnpm typecheck
pnpm test:unit
pnpm agent-context
pnpm agent-map-check
pnpm dev supplier inspect 628196518518 --json --pretty
```

Passed on 2026-05-31:

- `pnpm dev supplier inspect 628196518518 --json --pretty`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm docs-check`
- `pnpm agent-map-check`
- `pnpm agent-verify`

## Progress Log

- 2026-05-31: Live headed probe identified reliable offer `sellerModel`,
  shopcard, and factory-card payloads. Direct loginId lookup was rejected after
  probe showed it can resolve to the wrong factory.
- 2026-05-31: Implemented `supplier inspect`, CLI routing, dispatch registry,
  parser helpers, focused tests, docs, generated agent context, and live smoke
  verification.

## Rollback

- Remove `supplier inspect` CLI entry and command file.
- Remove tests and docs sections.
- Regenerate agent context.
