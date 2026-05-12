# 1688 — 1688 CLI for agents

When the user asks anything about 1688 sourcing, products, orders, or
logistics, use the `1688` CLI. It outputs JSON automatically when stdout
is piped, so `1688 <cmd> | jq` works.

## Current commands (MVP)

```
1688 login                Show QR code in the terminal; user scans with phone.
1688 login --headed       Use a real browser window instead (fallback).
1688 login --force        Re-login even if a session exists.
1688 search <keyword>     Search 1688 by keyword; --max N to limit.
1688 search --headed      Open window (use once to pass slider; cached for hours).
1688 image-search <path>  Search by image (.jpg/.png/.webp local file).
1688 order list           List buyer orders; --status, --page, --page-size flags.
1688 order list --status waitbuyerreceive    Filter to "awaiting delivery".
1688 order get <orderId>  Fetch one order by ID (scans recent pages; --max-scan-pages N).
1688 order logistics <orderId>  Shipping status + tracking number (mailNo, carrier, remark).
1688 cart list                  List items in 1688 cart (采购车).
1688 cart add <offerId> --sku <skuId> --qty N    Add SKU to cart (~15s, UI replay).
1688 cart remove <cartId>       Remove one cart item (~12s, UI replay).
1688 checkout prepare <cartId>... Preview total/address/items for checkout (NO order placement, ~12s).
1688 checkout confirm <cartId>...            PLACE order — TTY+prompt by default.
1688 checkout confirm <cartId>... --agent    Agent mode: no prompt, daemon-OK.
                                                MUST be preceded by a `prepare` call shown to the user
                                                AND explicit user authorization in the current turn.
1688 offer <offerId>      Full product detail: title, price range, SKUs (with stock), supplier, freight.
1688 whoami               Print current account, exit 3 if not logged in.
1688 whoami --verify      Also verify online (slower, ~3s).
1688 logout               Log out (prompts unless --yes).
1688 logout --yes         Skip confirmation.
1688 doctor               Diagnose environment + session state.
1688 doctor --no-launch   Skip the actual Chromium launch test (faster).

1688 daemon start         Start the background daemon (shared Chromium).
1688 daemon stop          Stop the daemon.
1688 daemon status        Show daemon state + stats.
1688 serve                Run daemon in the foreground.
```

## Daemon (recommended for agent use)

When the daemon is running, `search` and `whoami` route through it and share a
single Chromium context. Benefits:
- ~2-3 seconds saved per command (no Chrome cold start)
- Looks like one continuous human user to 1688 risk control
- Built-in inter-command throttle (1.2-3s jitter) keeps WAF score low

The agent should call `1688 daemon start` once at the beginning of a session
that involves multiple 1688 commands. The daemon auto-stops after 30 minutes
of inactivity.

`login`, `logout`, `doctor` stay inline; they require interactive UI or browser
windows. If the daemon is running and you need to `login --force`, stop the
daemon first.

```
```

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

## Discovery

Run `1688 --help` and `1688 <command> --help` for the latest flags.
