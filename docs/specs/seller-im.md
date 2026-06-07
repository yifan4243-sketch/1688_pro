# Seller IM

Seller IM commands cover pre-sale inquiry and post-sale follow-up through
Wangwang/1688 chat.

## Commands

```bash
1688 seller inquire <offerId> <message>
1688 seller chat <orderId|loginId> <message>
1688 seller messages --offer <offerId>
1688 seller messages <orderId|loginId>
1688 seller messages ... --watch
1688 inbox
```

## Safety

Sending messages contacts real suppliers. Follow `docs/SAFETY.md` before
sending agent-authored text.

## Agent Requirements

- Preserve line-delimited JSON in watch mode.
- Deduplicate messages by server-side `messageId` when available.
- Preserve `kind` and `card` fields so agents can distinguish text, offer
  cards, order cards, images, and auto replies.
- Keep order/offer scoped conversations attached to the right context.
