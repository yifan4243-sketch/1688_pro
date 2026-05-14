# 1688 — 1688 CLI for agents

When the user asks anything about 1688 sourcing, products, orders, or
logistics, use the `1688` CLI. It outputs JSON automatically when stdout
is piped, so `1688 <cmd> | jq` works.

## Current commands

Organized by buyer journey: sourcing → inquiry → cart → checkout → tracking → post-sale.

```
# Sourcing
1688 search <keyword>                       Keyword search; --max N to limit.
1688 search --headed                        Open window once if a slider verification appears.
1688 similar <offerId>                      "找同款" — similar offers from other suppliers, sorted by price.
1688 image-search <pathOrUrl>               Search by image (local .jpg/.png/.webp file or http(s) URL).
1688 offer <offerId>                        Full product detail: title, priceTiers, SKUs, attributes,
                                            packageInfo, supplier (loginId/memberId/province/city).

# Pre-sale inquiry (seller IM, scoped by offerId)
1688 seller inquire <offerId> <message>     Send product link + question to the supplier.
1688 seller messages --offer <offerId>      Read replies in this offer's conversation.
1688 seller messages --offer <offerId> --watch [--interval N]
                                            Live-tail new replies (line-delimited JSON when piped).
                                            Long-running; min interval 10 s, default 30 s.

# Cart
1688 cart list                              List items in 1688 cart (采购车).
1688 cart add <offerId> --sku <skuId> --qty N
                                            Add SKU to cart (~6 s, mtop hijack). Returns
                                            {added: CartItem, isNewRow, addedQuantity}.
1688 cart remove <cartId>                   Remove one cart row (~12 s, UI replay).

# Checkout
1688 checkout prepare <cartId>...           Preview total/address/items (NO order placement).
1688 checkout confirm <cartId>...           PLACE order — TTY+prompt by default.
1688 checkout confirm <cartId>... --agent   Agent mode: no prompt; use only after explicit approval.
                                            MUST be preceded by `prepare` shown to the user AND
                                            explicit user authorization in the current turn.

# Order tracking
1688 order list                             List buyer orders; --status, --page, --page-size flags.
                                            Each order has actions[] (buyer ops + URLs), services[]
                                            (insurance/refund), badges[].
1688 order list --status waitbuyerreceive   Filter to "awaiting delivery".
1688 order get <orderId>                    One order by ID (--max-scan-pages N, --status hint).
1688 order logistics <orderId>              Tracking number + trace (mailNo, carrier, remark).
1688 shipped <orderId>                      Order detail + logistics merged into one call.
1688 stuck [--days N]                       Paid but not shipped > N days (default 3).
1688 fake-shipped [--days N] [--debug]      Marked shipped but courier never collected (虚假发货).
1688 seller-history <sellerName>            All orders from a seller + avg ship days + on-time rate.

# Post-sale chat (seller IM, scoped by orderId)
1688 seller chat <orderId|loginId> <message>
                                            Send to seller. With orderId, auto-attaches the order card.
1688 seller chat <orderId> <message> --no-card
                                            Follow-up reply, no card.
1688 seller messages <orderId>              Read replies in this order's conversation.
1688 seller messages <orderId> --watch      Live-tail (same as the --offer form above).

# Account & daemon
1688 login                                  Show QR code; user scans with phone.
1688 login --headed                         Use a real browser window instead (fallback).
1688 login --force                          Re-login even if a session exists.
1688 logout [--yes]                         Log out (prompts unless --yes).
1688 whoami [--verify]                      Print current account; exit 3 if not logged in.
1688 doctor [--no-launch]                   Diagnose environment + session state.
1688 daemon start | stop | status | reload  Manage the background daemon.
1688 serve                                  Run the daemon in the foreground.
```

## Daemon (recommended for agent use)

When the daemon is running, commands route through it and share a single
Chromium context. Benefits:
- ~2-3 seconds saved per command (no Chrome cold start)
- One continuous logged-in session across commands
- Built-in inter-command jitter (1.2-3 s)

The agent should call `1688 daemon start` once at the beginning of a session
that involves multiple 1688 commands. The daemon auto-stops after 30 minutes
of inactivity. Run `1688 daemon reload` after the package updates to pick up
new code.

`login`, `logout`, `doctor` stay inline; they need interactive UI or browser
windows. If the daemon is running and you need to `login --force`, stop the
daemon first.

## Watch mode (long-running streams)

`1688 seller messages ... --watch` is a long-running command. It:
- Prints `Baseline: <conversation> — N messages in history` to stderr on start
- Emits one line of JSON to stdout per **newly-arrived** message (history is
  not re-emitted)
- Dedup is by server-side `messageId`
- Default interval 30 s, minimum 10 s, override with `--interval <seconds>`
- Exits cleanly on SIGINT (Ctrl+C)

For agent loops, pipe stdout into a `while read line` and parse each line as
its own JSON object. Do not assume the process will exit — it is meant to
stay alive.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Bad invocation (missing flag, etc.) |
| 3 | Not logged in / session expired |
| 5 | Another 1688 command is running (lock busy) |
| 6 | Chromium not installed |
| 7 | Login wait timeout |
| 4 | Aliyun risk control (slider verification) — retry with `--headed` |
| 8 | Login finished but cookies missing |
| 9 | Network error |
| 130 | User canceled |

## Status filter values (for `order list --status`)

| value | meaning |
|---|---|
| `all` | All orders |
| `waitbuyerpay` | 待付款 |
| `waitsellersend` | 待发货 |
| `waitbuyerreceive` | 待收货 |
| `success` | 已完成 |
| `cancel` | 已取消 |

## Rules for the agent

- `1688 login` opens a window the user must interact with. Only run it
  yourself if the user explicitly asks you to log in.
- `1688 logout` requires `--yes` in non-interactive mode. Do not pass
  `--yes` without explicit user confirmation in the current turn.
- If a command returns exit 3, tell the user to run `1688 login`.
  Do not loop or retry on your own.
- If a command returns exit 4 (risk control), tell the user to run the
  same command once with `--headed` (they will need to drag a slider).
  Do not retry the same command silently.
- **`1688 checkout confirm` requires a TTY by default**, OR `--agent` flag.
  It places real orders (no payment yet, but commits to seller). 
  
  **Agent protocol for placing orders:**
  1. Run `1688 checkout prepare <cartIds>` first
  2. SHOW the user the full preview (total, items, address, seller)
  3. WAIT for the user's explicit "yes, place it" / "下单吧" in the current turn
  4. Only then run `1688 checkout confirm <cartIds> --agent`
  5. Report the final orderId / URL back to the user
  
  NEVER run `--agent` without the prepare+approval cycle. NEVER infer authorization
  from older messages — it must be explicit in the CURRENT turn.
- JSON output of `whoami`:
  ```json
  {"loggedIn": true, "memberId": "...", "nick": "...", "lastVerifiedAt": "..."}
  {"loggedIn": false}
  ```

## Key JSON shapes

### `seller messages` result

```ts
{
  conversation: string,
  total: number,
  messages: Array<{
    sender: string,
    time: string | null,            // "YYYY-MM-DD HH:MM:SS" in +08:00
    isMine: boolean,
    content: string,
    read: boolean,
    kind: "text" | "offerCard" | "orderCard" | "autoReply"
        | "assessment" | "image" | "other",
    card?: { title: string|null, price: string|null,
             image: string|null, url: string|null },
    messageId?: string,             // present when sourced from WS
  }>,
}
```

`--watch` mode emits per-message instead:
```ts
{ conversation: string, message: <one item from messages[] above> }
```

### `cart add` result

```ts
{
  ok: boolean,
  added: CartItem,                  // see `cart list` JSON for full shape
  isNewRow: boolean,                // true=new cartId, false=merged into existing row
  addedQuantity: number,            // delta this call added (== args.quantity for new row)
}
```

To get the cartId reliably in a pipeline:
```bash
id=$(1688 cart add <offerId> --sku <skuId> --qty 1 | jq -r '.added.cartId')
```

## Output flags (every command)

In addition to `BB1688_JSON=1`, every command accepts:

```
--json            Force JSON output even in a TTY.
--pretty          Indent JSON by 2 spaces.
--get <path>      Print one field by dot-path. Scalar → raw line,
                  object/array → JSON. Wildcards stream one element per line.
                  Syntax: field.sub, arr[N].field, arr[*].field
--pick <paths>    Comma-separated dot-paths → emit a JSON object with each
                  path as a key. Useful for trimming output for downstream agents.
```

Examples:
```bash
1688 offer X --get supplier.name              # 深圳... (raw)
1688 offer X --get supplier                   # {"name":"...","loginId":"..."}
1688 offer X --get 'skus[*].price'            # 49 \n 68 \n 98.75 ...
1688 offer X --pick price,supplier.name       # {"price":1.25,"supplier.name":"..."}
1688 offer X --json --pretty                  # full payload, indented
```

When `--get`/`--pick` is given, the human renderer is skipped; the resolved
value(s) go to stdout. The full payload still flows through when neither
flag is set, so existing `| jq` pipelines keep working.

## Login in non-interactive sessions (Codex / Claude Code / scripted)

`1688 login` displays a QR code on stderr. ASCII rendering only works on
a real TTY — when invoked from an agent, stderr is usually piped and the
ASCII art either does not render or appears garbled.

The login command always **also** saves the QR as a PNG to
`~/.1688/login-qr.png` (`%USERPROFILE%\.1688\login-qr.png` on Windows)
and writes `QR saved as PNG: <path>` on stderr. The agent should:

1. Watch stderr for the `QR saved as PNG:` line.
2. Surface that file to the user (display the image inline, or tell the
   user the exact path so they can open it).
3. Wait for the command to exit naturally — the user must scan the QR
   with their 1688 mobile app within the timeout (default 300 s).

Do not attempt to "open" the raw QR URL in a browser — it is a token URL
that only the 1688 app can consume, not a human-readable page.

## Feedback / bug reports

```
1688 feedback "<message>"            Open a pre-filled GitHub issue (TTY browser).
1688 feedback --bug "<details>"      Tag the issue as a bug.
1688 feedback --no-open "<msg>"      Just print the URL — useful for agents to
                                     show the user without opening a browser
                                     on the agent's machine.
1688 feedback "<msg>" --submit       Post the issue DIRECTLY via the `gh` CLI
                                     (requires `gh auth login`). Skips the
                                     "Submit new issue" click in the browser.
```

**Agent rule for `--submit`**: do NOT add `--submit` on the agent's own
initiative. Always run without `--submit` first, show the user the
generated URL, and only re-run with `--submit` if the user explicitly
asks ("submit it" / "直接发吧" / "post the issue"). Posting an issue is
a public write action.

The CLI auto-attaches anonymized environment info (version, Node, OS) and
the last error from `daemon.log` if present. Nothing about the user's
1688 account is sent. The actual submission still requires the user to
click "Submit new issue" in the browser — the CLI only prepares the URL.

## Update awareness

At the start of a session that runs multiple 1688 commands, run
`1688 doctor`. Its JSON output includes a `version` block:

```json
{
  "version": {
    "current": "0.1.27",
    "latest":  "0.1.29",
    "updateAvailable": true,
    "updateCommand":   "npm i -g 1688-cli@latest",
    "error": null
  }
}
```

You can also detect updates from any command: in JSON mode (piped / `--json`
/ `BB1688_JSON=1`), a single line of structured JSON appears on stderr
when a newer version is cached:

```
{"_notice":"updateAvailable","current":"0.1.27","latest":"0.1.29","updateCommand":"npm i -g 1688-cli@latest"}
```

### Rules for upgrades

- **Interactive session** (TTY, the user is watching the conversation):
  ask the user once whether to upgrade now. Show the current → latest
  versions and the install command. If the user agrees, run
  `updateCommand`, then `1688 daemon reload` to pick up the new code.

- **Non-interactive** (CI, cron, scripted agent loop with no human in
  the loop): do NOT upgrade on your own. Log the notice to stderr and
  continue. Pinning is intentional in those contexts.

- Never run the install command without explicit user authorization in
  the CURRENT turn. The CLI version is part of the user's global
  environment; treat it the same way you treat any `sudo` or
  "modify global state" action.

- Ask at most once per session. If the user declines or postpones,
  don't ask again in the same session.

## Discovery

Run `1688 --help` and `1688 <command> --help` for the latest flags.
