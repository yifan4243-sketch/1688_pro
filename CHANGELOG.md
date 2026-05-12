# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
