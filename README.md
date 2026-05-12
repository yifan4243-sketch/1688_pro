# 1688-cli

[![npm version](https://img.shields.io/npm/v/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![npm downloads](https://img.shields.io/npm/dm/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![license](https://img.shields.io/npm/l/1688-cli.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/1688-cli.svg)](https://nodejs.org/)

**1688.com CLI for humans, Codex, and Claude Code.**

Two core flows from the terminal:

- **Sourcing** — search / image-search / product detail / pre-sale inquiry
- **Orders** — list / detail / logistics tracking / post-sale chat with sellers

Outputs human text on a TTY and JSON when piped, so AI agents can drive it
without parsing.

```bash
npm i -g 1688-cli
1688 login                                       # scan QR with the 1688 app

# Sourcing
1688 search "机械键盘" --max 10                   # keyword search
1688 image-search ./sample.jpg                   # search by image
1688 offer 628196518518                          # product detail (price / SKUs / seller)
1688 seller inquire 628196518518 "支持定制 logo 吗？"   # pre-sale inquiry

# Orders
1688 order list --status waitsellersend          # list orders
1688 order get   <orderId>                       # one order's detail
1688 order logistics <orderId>                   # tracking + trace
1688 seller chat <orderId> "麻烦尽快发货谢谢"      # post-sale inquiry (auto-attaches order card)
```

---

## Why

Existing 1688 automation options are heavy: Selenium glue you maintain, browser
extensions you can't pipe into a shell, MCP servers that fight with your
agent's tooling. `1688-cli` is a single command:

- **Real Chrome under the hood** (`channel:'chrome'` + stealth). Reduced
  risk-control hits compared to bundled Chromium.
- **Persistent profile** at `~/.1688/`. One login lasts for weeks.
- **Long-running daemon** — first command warms the browser, subsequent
  commands reuse it (no relaunch per call).
- **JSON-or-text dual mode** — `1688 order list | jq` works; `1688 order list`
  in your terminal pretty-prints.
- **Designed for AI agents.** See [AGENTS.md](./AGENTS.md) for the contract.

### Not in scope

This is not a marketing / scraping tool for bulk-listing the whole site, and
not a checkout automation farm. It mirrors what a buyer does manually: pick
a product, ask the seller a question, place an order, track shipping. Place
order (`checkout confirm`) is gated behind TTY prompts or an explicit
`--agent` flag so agents can't move money silently.

---

## Install

Requires Node 20+ and (recommended) Google Chrome installed. Without Chrome,
postinstall downloads Playwright's bundled Chromium (~150 MB; China users get
the npmmirror automatically).

```bash
npm i -g 1688-cli
1688 doctor                # verify environment
1688 login                 # one-time, scan QR on phone
```

---

## Commands

### Account

```bash
1688 login                              # scan QR; auto-starts daemon
1688 login --headed                     # open real window (fallback for risk control)
1688 login --force                      # re-login even if cached
1688 logout                             # clear cookies
1688 whoami                             # current nick + memberId
1688 doctor                             # environment check
```

### Daemon

```bash
1688 daemon start | stop | status | reload
```

### Search & browse

```bash
1688 search 机械键盘 --max 20
1688 image-search ./shoe.jpg            # local file
1688 image-search https://.../img.png   # http(s) URL
1688 offer 628196518518                 # product detail
```

### Orders

```bash
1688 order list                                       # all statuses
1688 order list --status waitsellersend               # paid, awaiting shipment
1688 order list --status waitbuyerreceive             # shipped, awaiting delivery
1688 order get   <orderId>
1688 order logistics <orderId>                        # tracking number + trace
1688 order get  <orderId> --status waitbuyerreceive   # speeds up scan on heavy accounts
```

### Cart

```bash
1688 cart list
1688 cart add    <offerId> --sku <skuId> --qty 2
1688 cart remove <cartId>
```

### Checkout (writes!)

```bash
1688 checkout prepare <cartIds...>      # preview only — safe
1688 checkout confirm <cartIds...>      # default: TTY prompt y/N
1688 checkout confirm <cartIds...> -y   # skip prompt (TTY still required)
1688 checkout confirm <cartIds...> --agent   # AI-agent mode: no prompts
```

### Seller IM (旺旺)

```bash
1688 seller inquire <offerId> "支持定制 logo 吗？"     # pre-sale (auto-finds seller)
1688 seller chat    <orderId> "麻烦尽快发货谢谢"        # post-sale (auto-attaches order card)
1688 seller chat    <orderId> "..." --no-card          # follow-up reply, no card
1688 seller messages <orderId> --limit 20
1688 seller messages <orderId> --since 2026-05-01T00:00:00+08:00
```

### Workflow shortcuts

```bash
1688 shipped <orderId>                  # order detail + logistics merged
1688 stuck --days 3                     # paid but not shipped > N days
1688 fake-shipped --days 1              # marked shipped but courier never collected (虚假发货)
1688 fake-shipped --debug               # show each candidate's status + remark
1688 seller-history <sellerName>        # all orders + avg ship days + on-time rate
```

---

## JSON for agents

Every command auto-switches to JSON when stdout is piped:

```bash
1688 order list --status waitsellersend | jq '.orders[] | {id: .orderId, paid: .paidAt}'
1688 fake-shipped --debug             | jq '.orders[].orderId'
1688 search 雨伞                       | jq '.offers[0:5]'
```

Force JSON on a TTY:

```bash
BB1688_JSON=1 1688 doctor
```

---

## Risk control

1688's WAF triggers a slider challenge on suspicious traffic.
`1688-cli` already uses real Chrome + stealth + a persistent profile, and the
`search` command warms up `s.1688.com` before every request. If you still hit
a slider, solve it once with `--headed`:

```bash
1688 search 雨伞 --headed     # window opens; drag the slider once
1688 search 雨伞              # subsequent headless calls work for hours
```

---

## Files & directories

```
~/.1688/profiles/default/   Chromium profile (cookies, IndexedDB, fingerprint)
~/.1688/state.json          cached identity (nick / memberId / timestamps)
~/.1688/daemon.sock         daemon Unix socket
~/.1688/daemon.pid          daemon PID
~/.1688/.lock               proper-lockfile (one process at a time)
```

## Environment variables

```
BB1688_NO_DAEMON=1          disable daemon, always run inline
BB1688_JSON=1               force JSON output on TTY
BB1688_DEBUG=1              verbose internal logs to stderr
BB1688_FORCE_CHROMIUM=1     skip system Chrome, use bundled Chromium
BB1688_HOME=<path>          override ~/.1688
BB1688_SKIP_POSTINSTALL=1   skip Chromium download during npm install
PLAYWRIGHT_DOWNLOAD_HOST    custom Playwright mirror
```

---

## Status

Pre-1.0 — the surface is shaped but minor breaks are possible between minor
versions until 1.0. See [CHANGELOG.md](./CHANGELOG.md). Not affiliated with
Alibaba / 1688.

## Agent contract

If you're driving `1688-cli` from Codex, Claude Code, or another autonomous
agent, read [AGENTS.md](./AGENTS.md) — it documents JSON shapes, exit codes,
and the rules around the write commands.

## License

[MIT](./LICENSE)
