# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.32] - 2026-05-14

### Added
- **Daemon version checks.** The daemon now writes `daemon.version`, reports
  its version in `1688 daemon status`, and the CLI refreshes a stale daemon
  before sending commands so upgrades do not silently reuse old runtime code.
- **Runtime diagnostics for agents.** `1688 daemon status` now includes
  browser health, current URL, and classified page state when a shared browser
  context is active.
- **Failure artifacts.** Browser-backed command failures now save a debug
  bundle under `~/.1688/runs/<requestId>/` with `meta.json`,
  `screenshot.png`, and `page.html` when available. `CliError` details can
  carry `artifactDir`, `currentUrl`, `pageState`, `category`, `retryable`,
  and `recoverHint` for agent-friendly recovery.

### Fixed
- CLI and daemon error propagation now preserves structured diagnostic details
  instead of returning only `code` and `message`.
- Page-state detection classifies common 1688 failure modes: login redirects,
  slider/security verification, and rate-limit pages.

## [0.1.31] - 2026-05-14

### Added
- **`1688 feedback --submit`** — post the issue directly via the GitHub
  CLI (`gh`). Checks `gh --version` and `gh auth status` first, then
  runs `gh issue create --repo superjack2050/1688-cli ...`. The flag is
  opt-in by design: agents and users still get the safer browser flow
  by default, and only escalate to direct submission when explicitly
  asked.

### Fixed
- `1688 feedback "<message>"` swallowed almost all of the message on
  macOS when the user's shell auto-replaced straight `"` with smart
  quotes (`“ ”`) — the shell saw them as literal characters, split the
  argument list, and only the first piece reached the CLI. The
  `<message>` argument is now variadic; all remaining args are joined
  with a space, so the message survives regardless of how the shell
  parses quotes. Leading/trailing smart quotes are also stripped from
  the joined result.
- Reject feedback messages shorter than 5 characters with a hint about
  using single quotes on macOS.

## [0.1.30] - 2026-05-13

### Fixed
- **`1688 login` now works under Codex / Claude Code / any agent**.
  The QR code was rendered as terminal ASCII only when stderr was a
  real TTY; agents typically pipe stderr, so the QR never displayed.
  Login now always also saves the QR as a PNG to
  `~/.1688/login-qr.png` (`%USERPROFILE%\.1688\login-qr.png` on
  Windows) and prints `QR saved as PNG: <path>` on stderr, so an agent
  can surface the image to the user.

### Added
- **`1688 feedback <message>`** — submit feedback or report a bug via a
  pre-filled GitHub issue. Auto-attaches anonymized environment info
  (version, Node, OS) and the last error from `daemon.log` if present.
  On a TTY, opens the issue page in the user's browser. With
  `--no-open` or in JSON mode, prints the URL so an agent can show it
  to the user without opening the agent's own browser.
  ```
  1688 feedback "the slider verification looped on day 3"
  1688 feedback --bug "cart-add failed for SKUs with X attribute"
  ```
  AGENTS.md gains "Login in non-interactive sessions" and "Feedback /
  bug reports" sections.

## [0.1.29] - 2026-05-13

### Added
- **Agent-friendly update awareness.** Two new signals so AI agents can
  detect new versions without parsing the human update banner:
  - `1688 doctor` JSON output now includes a `version` block with
    `current`, `latest`, `updateAvailable`, `updateCommand`, and `error`
    (when the registry check fails).
  - In JSON mode (piped output / `--json` / `BB1688_JSON=1`), any
    command emits a single structured line on stderr when a newer
    version is cached:
    `{"_notice":"updateAvailable","current":"0.1.x","latest":"0.1.y","updateCommand":"npm i -g 1688-cli@latest"}`
  - AGENTS.md gains an "Update awareness" section documenting both
    signals and the rules: ask the user before upgrading in interactive
    sessions; do nothing in non-interactive (CI / cron) ones; never
    run the install command without explicit current-turn authorization.

## [0.1.28] - 2026-05-13

### Documentation
- README: document the `--json` / `--pretty` / `--get` / `--pick` flags in
  the "JSON for agents" section with copy-pasteable examples.
- AGENTS.md: add an "Output flags" section so agents can discover the
  zero-`jq` workflows.

## [0.1.27] - 2026-05-13

### Added
- **Four output-shaping flags on every command**, no `jq` needed:
  - `--json` — force JSON output even when stdout is a TTY.
  - `--pretty` — indent JSON by 2 spaces.
  - `--get <path>` — print one field by dot-path. Syntax:
    `field.sub`, `arr[0].field`, `arr[*].field` (wildcards stream one
    line per element). Scalars print raw; objects/arrays print JSON.
  - `--pick <paths>` — comma-separated dot-paths → emit a JSON object
    with each path as a key. Good for trimming output for agents.

  Examples:
  ```
  1688 offer X --get supplier.name             # 深圳狼途实业科技有限公司
  1688 offer X --get supplier                  # {"name":"...","loginId":"..."}
  1688 offer X --get 'skus[*].price'           # 49 \n 68 \n 98.75 ...
  1688 offer X --pick price,supplier.name      # {"price":1.25,"supplier.name":"..."}
  1688 offer X --json --pretty                 # full pretty-printed JSON in TTY
  ```

  Implemented in `src/io/output.ts`; flags are added to every command
  through a recursive walk of commander's command tree plus a `preAction`
  hook that pushes the values into the output module before `emit()` runs.

## [0.1.26] - 2026-05-13

### Fixed
- **Windows daemon never started** (`EACCES: permission denied` on
  `daemon.sock`). Node's `net.listen()` can't bind a filesystem path on
  Windows — it needs a named pipe (`\\.\pipe\...`). The daemon now uses
  `\\.\pipe\1688-cli-daemon` on Windows and skips the `fs.unlink` of the
  socket path (named pipes auto-clean). Unix behavior is unchanged.
- `isDaemonReachable()` on Windows no longer fails the existence check
  before connecting — named pipes don't appear in the filesystem.

## [0.1.25] - 2026-05-13

### Added
- **`1688 similar <offerId>`** — find similar offers ("找同款") via the
  shared search mtop endpoint. Sorted by price, useful for comparing
  suppliers of the same product.
- **`1688 seller messages --watch [--interval <s>]`** — live-tail a
  conversation. Polls and emits only newly-arrived messages as
  line-delimited JSON when stdout is piped. Dedup is by server-side
  `messageId`. Default interval 30 s, minimum 10 s.
- `seller messages` results now include richer `kind` subtypes:
  `text` / `offerCard` / `orderCard` / `autoReply` / `assessment` /
  `image` / `other`, plus a stable `messageId`. Offer/order cards expose
  `card.url`, and offer cards are enriched with `card.title` / `.price` /
  `.image` from the IM client's hydrated card.
- `cart add` JSON response now includes `isNewRow` (bool) and
  `addedQuantity` (number). Pipelines can pick up the new cartId reliably
  even when the SKU is merged into an existing row.
- `offer` returns a much richer payload: `priceTiers[]`, `attributes[]`,
  `packageInfo[]`, `images[]`, `saleCount`, `categoryId`, and a fuller
  `supplier` (loginId, memberId, province, city). SKU variants gain
  `multiPrice`, `saleCount`, and `image`.
- `order list` returns `actions[]` (buyer-side ops with jump URLs),
  `services[]` (insurance / refund metadata with payer), `badges[]`,
  `originalAmount`, `discountAmount`, `adjustment`, and `bizType`.

### Changed
- **`cart add` now uses mtop hijack (Route B)** instead of full UI replay.
  Wall time is similar (~6 s) but works uniformly across single-attr and
  multi-attr SKU layouts, including dropdown-style selectors and hidden
  rows that previously broke the UI path.
- **`seller messages` now uses WebSocket / LWP protocol interception
  (Route C)** instead of DOM scraping. Server-truth timestamps
  (millisecond `createAt`), stable `messageId`, and URL extraction from
  offer/order cards. DOM scraping is retained as a fallback when no
  WebSocket frames are captured.
- `image-search` reuses the search mtop interception path; shared parser
  helpers (`parseMtopJsonp`, `mapOffer`, `SEARCH_MTOP_API`) are now
  exported from `search.ts` for `similar` to consume too.

### Fixed
- `cart list` returned `amount: 2` for items priced over ¥1,000 because
  `parseFloat("2,094.00")` stops at the thousand-separator comma. Now
  uses the integer-cent fields (`unitPriceCent`, `amountCent`) when
  present, with a comma-stripping string parser as fallback.
- `cart add` could return the wrong `cartId` when the same SKU was
  already in the cart (the server merges into the existing row). Now
  snapshots the cart before/after and diffs to find the affected row,
  exposing whether it was a new row or a merge plus the delta quantity.

## [0.1.24] - 2026-05-13

### Fixed
- `BB1688_PROBE=1` output was silent when stdout was piped because `info()`
  is suppressed under JSON mode. The probe now writes directly to stderr,
  and prints `[probe] active` on start so you can confirm it's running.
- Broader JSON markers (`window.runParams`, `"offerList"`, `"offerId":`).

## [0.1.23] - 2026-05-13

### Changed
- `BB1688_PROBE=1` now also logs non-mtop XHR calls and scans the SSR HTML
  response for inline JSON markers (`window.__INITIAL_STATE__`, etc.). If
  search doesn't fire any mtop, the SSR HTML is the real data source.

## [0.1.22] - 2026-05-13

### Added
- `BB1688_PROBE=1` diagnostic: when set, `search` prints every mtop API call
  fired during the page load. Used to identify the right endpoint for
  migrating `search` / `image-search` from DOM scraping to mtop interception
  (which is what `order` / `cart` already use).

## [0.1.21] - 2026-05-13

### Fixed
- `search` / `image-search` result extraction was returning garbage fields:
  the title held the entire card's concatenated text, the price was a
  bulk-order tier (`¥0.011000000~4999999`), and every row showed the same
  supplier. Three independent bugs:
  - Card boundary "walk up until parent has price + img" over-walked into
    the results container, so all rows shared one ancestor.
  - Title fallback used `anchor.textContent`; when the anchor wraps the
    whole card that's the whole card text.
  - Price regex ran on concatenated innerText where neighbour numbers had
    no whitespace separator.

  Replaced with: walk up until parent contains more than one offerId; title
  from `[class*=title]` / `img[alt]` / `<a title>` only; price from leaf
  elements whose total text matches a price pattern (with sanity bounds);
  supplier from `shop*.1688.com` / `winport` subdomain links only.

## [0.1.20] - 2026-05-13

### Fixed
- Daemon auto-starts on any command that wants to use it, not just `login`.
  After `npm i -g 1688-cli` the postinstall stops the previous daemon (since
  0.1.3); previously you had to manually run `1688 daemon start` or `1688
  login` to bring it back. Now `1688 search ...` etc. will start the daemon
  transparently if it's not running.

## [0.1.19] - 2026-05-13

### Fixed
- `search`: removed a second hardcoded `waitForSelector('.search-offer-item ...')`
  that ran AFTER `waitPastBlocking`. The class name is gone from current
  1688 markup, so the wait timed out — 15s on headless, 180s on `--headed`.
  `waitPastBlocking` already confirmed the page loaded; the extra gate was
  redundant.
- `extractOffers` rewritten to be class-agnostic: seed from offer-detail
  anchor hrefs (URL pattern stable for years), walk up to find the card-like
  ancestor, extract title/price/image. Survives 1688 markup reshuffles.

## [0.1.18] - 2026-05-13

### Fixed
- Any inline-mode command (`--headed`, `--profile`, `BB1688_NO_DAEMON=1`) no
  longer fails with `LOCK_BUSY` when the daemon is running. Dispatch now
  pauses the daemon for the duration of the inline call and resumes it
  after, mirroring what `checkout confirm` already did. Affects `search
  --headed`, `image-search --headed`, etc.

## [0.1.17] - 2026-05-13

### Fixed
- `login`: idempotent — running `1688 login` a second time while the daemon
  is alive no longer fails with `LOCK_BUSY`. The already-logged-in check
  now reads cached identity from `state.json` first (no browser, no lock)
  and only falls back to a browser cookie peek if the cache is missing.

## [0.1.16] - 2026-05-13

### Changed
- `search`: lowered detection thresholds (anchors 30→15, bodyLen 2000→800) so
  partially-hydrated SPA results pages clear faster.
- `search`: `BB1688_DEBUG=1` now prints `url / title / anchorCount / bodyLen`
  every second during the wait — makes it visible whether the page is
  loading, on a slider, or our detection just under-triggered.

## [0.1.15] - 2026-05-13

### Fixed
- Auto-clean stale `.lock.lock` directory when no daemon is alive. Previously,
  killing a `--headed` flow with Ctrl+C left a lock that blocked every
  subsequent command with `LOCK_BUSY` until manually `rm -rf`'d. The probe
  is safe: if a daemon process actually holds the lock, the original
  "Another 1688 command is running" error is preserved.

## [0.1.14] - 2026-05-13

### Changed
- Description in `package.json` and the GitHub repo "About" updated to reflect
  the actual core flow (sourcing + orders) instead of niche shortcuts.

## [0.1.13] - 2026-05-13

### Added
- `seller messages --offer <offerId>`: read pre-sale inquiry replies scoped
  by offerId, symmetric to `seller inquire`. Previously you had to
  remember the seller's name and pass it in sidebar mode.

## [0.1.12] - 2026-05-13

### Changed
- README: showcase now highlights the actual core procurement flow
  (search → image-search → offer → inquire → order list → order get →
  logistics → post-sale chat), not the niche `stuck` / `fake-shipped`
  shortcuts. Those remain in the Workflow shortcuts section.

## [0.1.11] - 2026-05-13

### Fixed
- `search`: result-page detection no longer binds to specific card class
  names (which 1688 reshuffles every few months). Now uses two resilient
  signals — page URL not on a punish host, plus a large anchor count and
  body length. Previously the command would hang after a user solved the
  slider in `--headed` mode because none of the hardcoded selectors matched
  the current markup.

## [0.1.10] - 2026-05-13

### Changed
- `package.json`: corrected `repository`, `homepage`, and `bugs` URLs to the
  actual GitHub user `superjack2050/1688-cli`. The npm package page will now
  link to the public source.

## [0.1.9] - 2026-05-13

### Changed
- Rewrote `README.md` for end users (was still MVP-era developer notes).
  Now covers the full command catalog, JSON-for-agents flow, and risk-control
  guidance. 0.1.8 carried the manifest changes but the README write failed —
  this is the real publish.
- Added badges (version, downloads, license, node) to the README.

## [0.1.8] - 2026-05-13

### Changed
- Added `keywords`, `repository`, `homepage`, `bugs` to `package.json` for
  npm search discoverability.

## [0.1.7] - 2026-05-13

### Changed
- `search`: replaced 1.5s-interval polling of the result-page selectors with
  event-driven `waitForSelector`. Saves up to 1.5s per search when cards
  render before the next poll tick.

## [0.1.6] - 2026-05-13

### Changed
- `search`: always warm up `s.1688.com` before the actual search (instead of
  only on first run). Cookie-presence checks can't detect server-side
  invalidation or expiry, so a constant ~1.5s overhead trades small latency
  for stability.
- `search`: on a headless WAF trigger, automatically re-warm with a longer
  pause and retry once before bailing. Cuts manual `--headed` interventions.

## [0.1.5] - 2026-05-13

### Fixed
- `search`: result page detection only checked the legacy `.search-offer-item`
  class; 1688 reshuffles markup periodically and the new class names caused
  the command to hang on a fully-loaded page until timeout. Now matches
  multiple known selectors plus the offer-detail link pattern.
- `search`: dropped body-text matching from the WAF detector — product names
  and footer ads occasionally contain `滑动` / `验证` substrings, producing
  false positives. URL path + page title is enough.

## [0.1.4] - 2026-05-13

### Changed
- `search`: warm up `s.1688.com` (visit the homepage first) on the very first
  search per browser session so the WAF sees an organic browse before the
  search request. Skipped on subsequent searches (cookies already cached).
  Cold-start search was the #1 trigger of the slider challenge.

## [0.1.3] - 2026-05-13

### Fixed
- Postinstall: stop any running daemon during `npm i -g 1688-cli` so the next
  command auto-starts a fresh daemon running the new code. Previously the
  long-lived daemon kept serving the old code after an upgrade until the user
  ran `1688 daemon stop` manually.

## [0.1.2] - 2026-05-13

### Fixed
- `doctor`: the "browser launch" check now mirrors runtime preference — tries
  system Chrome first via `channel: 'chrome'`, falls back to bundled Chromium.
  Previously failed after Playwright minor bumps left the bundled Chromium
  version stale, even though the runtime already prefers Chrome.

## [0.1.1] - 2026-05-13

### Added
- Update notifier: prints a one-line banner on next run when a newer version
  is on npm. Checks at most once per day; non-blocking, ignored in CI / pipes.
- MIT license.

### Changed
- Postinstall: skip Chromium download when a system Chrome is detected
  (macOS / Windows / Linux). Runtime already prefers system Chrome via
  `channel: 'chrome'`, so most users save the 150MB download.
- Postinstall: auto-select the npmmirror Playwright mirror on China timezones
  (`Asia/Shanghai` etc.) — no env-var required. International users still hit
  the official source.

## [0.1.0] - 2026-05-12

Initial release.

Commands: `login`, `logout`, `whoami`, `doctor`, `daemon`,
`search`, `image-search`, `offer`,
`order list/get/logistics`,
`cart list/add/remove`,
`checkout prepare/confirm`,
`seller chat/inquire/messages`,
`shipped`, `stuck`, `fake-shipped`, `seller-history`.
