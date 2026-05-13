# 1688-cli: Alibaba 1688.com CLI - Product Search, Inquiry, Cart, Checkout, Order Tracking & Seller Chat for AI Agents & Humans

[![npm version](https://img.shields.io/npm/v/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![npm downloads](https://img.shields.io/npm/dm/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![license](https://img.shields.io/npm/l/1688-cli.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/1688-cli.svg)](https://nodejs.org/)

Command-line tool for Alibaba 1688.com wholesale: keyword & image search,
supplier inquiry, cart, checkout, order tracking, and seller chat. Outputs
JSON when piped (for Codex / Claude Code / other AI agents) and pretty TTY
text for humans.

The 6 things you can do from the terminal:

1. **Sourcing** — search / similar / image-search / product detail
2. **Pre-sale inquiry** — ask the supplier, watch replies live
3. **Cart** — collect SKUs (with diff-based add confirmation)
4. **Checkout** — preview + place the order
5. **Order tracking** — list / detail / logistics / overdue detection
6. **Post-sale chat** — chase shipment, read replies as JSON stream

```bash
npm i -g 1688-cli
1688 login                                       # scan QR with the 1688 app

# Sourcing
1688 search "佛龛柜" --max 10                                 # keyword search
1688 similar 628196518518 --max 10                            # find similar offers, sorted by price
1688 image-search ./sample.jpg                                # search by image
1688 offer 628196518518                                       # product detail

# Pre-sale inquiry (with live watch for AI agents)
1688 seller inquire 628196518518 "支持定制 logo 吗？"          # ask seller
1688 seller messages --offer 628196518518                     # one-shot read
1688 seller messages --offer 628196518518 --watch             # live-tail new replies (JSON when piped)

# Order tracking & post-sale chat
1688 order list --status waitsellersend                       # list orders
1688 order get      <orderId>                                 # one order detail
1688 order logistics <orderId>                                # tracking + trace
1688 seller chat    <orderId> "麻烦尽快发货谢谢"               # chase shipment
1688 seller messages <orderId>                                # read seller's reply
```

---

## Why

Existing 1688 automation options are heavy: Selenium glue you maintain, browser
extensions you can't pipe into a shell, MCP servers that fight with your
agent's tooling. `1688-cli` is a single command:

- **Real Chrome under the hood** (`channel:'chrome'`). Same browser you'd
  use manually — your session is real, not a synthetic Chromium.
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

Organized by the buyer journey: discover → ask → decide → buy → track →
follow up.

### 1. Sourcing — find the right supplier

```bash
1688 search 机械键盘 --max 20                    # keyword search
1688 similar 628196518518 --max 20               # "找同款" — same product, other suppliers, sorted by price
1688 image-search ./shoe.jpg                     # search by local image
1688 image-search https://.../img.png            # search by http(s) URL
1688 offer 628196518518                          # product detail (priceTiers, attributes, packageInfo, SKUs)
```

### 2. Pre-sale inquiry — ask the supplier

> Uses the same `seller messages` / `seller chat` tooling as §6, scoped by
> `--offer <offerId>` instead of an orderId.

```bash
1688 seller inquire 628196518518 "支持定制 logo 吗？"               # send a product link + question
1688 seller messages --offer 628196518518                          # read replies (one-shot)
1688 seller messages --offer 628196518518 --since 2026-05-13T10:00:00+08:00
1688 seller messages --offer 628196518518 --watch --interval 30    # live-tail new replies
```

**Watch mode** prints only newly-arrived messages as line-delimited JSON
when stdout is piped — pipe into any agent. Dedup is by server-side
`messageId`. Min interval 10 s.

### 3. Cart — collect SKUs

```bash
1688 cart list
1688 cart add    <offerId> --sku <skuId> --qty 2
1688 cart remove <cartId>
```

`cart add` returns `{added: CartItem, isNewRow, addedQuantity}` so pipelines
can pick up the new cartId reliably even when the same SKU is already in cart
(server merges into the existing row in that case):

```bash
id=$(1688 cart add 628196518518 --sku 6070845665229 --qty 1 | jq -r '.added.cartId')
1688 cart remove "$id"
```

### 4. Checkout — place the order

```bash
1688 checkout prepare <cartIds...>           # preview total/address/items — safe, read-only
1688 checkout confirm <cartIds...>           # default: TTY prompt y/N
1688 checkout confirm <cartIds...> -y        # skip prompt (TTY still required)
1688 checkout confirm <cartIds...> --agent   # AI-agent mode: no prompts (explicit autonomy opt-in)
```

### 5. Order tracking — follow the shipment

```bash
1688 order list                                       # all statuses (with actions, services, badges)
1688 order list --status waitsellersend               # paid, awaiting shipment
1688 order list --status waitbuyerreceive             # shipped, awaiting delivery
1688 order get   <orderId>                            # one order detail
1688 order logistics <orderId>                        # tracking number + trace
1688 order get  <orderId> --status waitbuyerreceive   # narrow the scan on heavy accounts

# Convenience views
1688 shipped <orderId>                  # order detail + logistics merged
1688 stuck --days 3                     # paid but not shipped > N days
1688 fake-shipped --days 1              # marked shipped but courier never collected (虚假发货)
1688 fake-shipped --debug               # show each candidate's status + remark
1688 seller-history <sellerName>        # all orders + avg ship days + on-time rate
```

### 6. Post-sale chat — chase delivery / claims

> Same tooling as §2, scoped by `<orderId>` so messages auto-attach the
> order card and replies thread under the right conversation.

```bash
1688 seller chat <orderId> "麻烦尽快发货谢谢"                     # send (auto-attaches order card)
1688 seller chat <orderId> "请问什么时候发货" --no-card           # follow-up, no card
1688 seller messages <orderId>                                  # read replies
1688 seller messages <orderId> --limit 50 --since 2026-05-01T00:00:00+08:00
1688 seller messages <orderId> --watch                          # live-tail
```

### Account & daemon

```bash
1688 login                              # scan QR; auto-starts daemon
1688 login --headed                     # open real window (fallback for risk control)
1688 login --force                      # re-login even if cached
1688 logout                             # clear cookies
1688 whoami                             # current nick + memberId
1688 doctor                             # environment check

1688 daemon start | stop | status | reload
```

---

## FAQ

### Compared to alternatives

#### How does 1688-cli compare to MCP servers and Selenium scripts?

1688-cli runs as a regular shell command, not an MCP server. Agents call it
via `child_process` or shell pipes instead of the MCP protocol — easier to
compose with `jq`, `xargs`, and CI scripts. Compared to writing low-level
browser automation directly, 1688-cli ships with structured JSON output,
session persistence, and a daemon for warm context, so you don't reinvent
that per project.

#### Does 1688 have an official API I should use instead?

Alibaba offers a 1688 Open API at `open.1688.com`, but it's gated to
enterprise ISV partners with a sales contract and per-app authorization.
Individual buyers, small businesses, and AI agents typically can't get
access. 1688-cli uses your normal logged-in buyer account via a one-time
QR scan, mirroring what you can do manually in a browser — no developer
keys required.

### Account & verification

#### Does this tool require any 1688 developer account or API keys?

No. Login is a one-time QR scan with your normal 1688 mobile app — the
same flow as logging into 1688 on a fresh browser. The session is stored
in your local profile (`~/.1688/profiles/default/`) and reused across
commands, so you only re-scan when 1688 invalidates it.

#### What happens if 1688 shows a verification challenge (滑块)?

1688 occasionally shows a slider verification on unfamiliar sessions or
after long inactivity — the same one you'd see when logging in from a new
device manually. If a command fails because of this, run it once with
`--headed` (e.g. `1688 search 雨伞 --headed`); a real window opens, you
drag the slider yourself, and the verified session is reused for
subsequent commands. There is no automated solver — it's the same manual
step a person would take.

#### Is it safe to use? Will my account get rate-limited?

The tool drives your own logged-in browser session and only performs
actions you'd do manually — search, read order details, send chat
messages, place an order you confirmed. Use it at human pace (the default
`--watch` interval is 30 seconds, minimum 10) for one of your own
accounts. Aggressive automation, high-frequency scraping, or running it
across many accounts is outside the tool's design and increases the
chance of triggering 1688's risk controls.

---

## JSON for agents

Every command auto-switches to JSON when stdout is piped:

```bash
1688 order list --status waitsellersend | jq '.orders[] | {id: .orderId, paid: .paidAt}'
1688 fake-shipped --debug             | jq '.orders[].orderId'
1688 search 雨伞                       | jq '.offers[0:5]'
```

### Built-in JSON flags (no `jq` required)

Every command supports four output-shaping flags. Useful on Windows or any
environment where `jq` isn't installed — and for agents that want concise
output without parsing the full payload.

```bash
1688 offer <id> --json                       # force JSON even in a TTY
1688 offer <id> --json --pretty              # JSON with 2-space indent

1688 offer <id> --get supplier.name          # one scalar field, raw line
1688 offer <id> --get supplier               # sub-object as JSON
1688 offer <id> --get 'skus[0].skuId'        # array index
1688 offer <id> --get 'skus[*].price'        # wildcard — one line per element

1688 offer <id> --pick price,supplier.name,'skus[0].skuId'
# {"price":1.25,"supplier.name":"...","skus[0].skuId":"..."}
```

Path syntax: `field.sub`, `arr[N].field`, `arr[*].field`. Wildcards stream
one line per element; scalars print as a raw line (no quotes), objects and
arrays as JSON. The full payload still goes through when no `--get`/`--pick`
is given, so existing `| jq` pipelines keep working unchanged.

Force JSON in a TTY (alternative to `--json`):

```bash
BB1688_JSON=1 1688 doctor
```

---

## Risk control

If 1688 shows a slider verification (滑块), solve it once with `--headed`:

```bash
1688 search 雨伞 --headed     # window opens; drag the slider yourself
1688 search 雨伞              # subsequent calls reuse the verified session
```

See also the FAQ entry on [verification challenges](#what-happens-if-1688-shows-a-verification-challenge-滑块).

---

## Files & directories

```
~/.1688/profiles/default/   Chromium profile (cookies, IndexedDB, session state)
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
