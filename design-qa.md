# Design QA

## Visual source of truth

- `C:\Users\yifan\AppData\Local\Temp\codex-clipboard-9bfc220d-83af-4f6b-96a7-4a100d98974f.png`
- User instruction represented by the annotations and follow-up: replace the horizontal 1688 → Ozon switcher with two vertical rows; each row has the existing logo on the left and its text flush to the right.

## Implementation evidence

- Full renderer capture: `D:\OpenAI\CodexHome\visualizations\2026\08\08\019fe148-67f9-71b2-9fc0-f96aba04f647\implementation-full.png`
- Focused sidebar capture: `D:\OpenAI\CodexHome\visualizations\2026\08\08\019fe148-67f9-71b2-9fc0-f96aba04f647\implementation-sidebar.png`
- Combined comparison input: `D:\OpenAI\CodexHome\visualizations\2026\08\08\019fe148-67f9-71b2-9fc0-f96aba04f647\qa-sidebar-comparison.png`
- Capture metrics and console output: `D:\OpenAI\CodexHome\visualizations\2026\08\08\019fe148-67f9-71b2-9fc0-f96aba04f647\capture-metrics.json`

## Viewport, size, density, and state

- Source screenshot: 1783 × 941 physical pixels.
- Electron renderer capture: 1903 × 942 physical pixels at Windows 125% display scaling.
- Focused implementation region: 242 × 230 CSS px, captured as 303 × 288 physical pixels (`deviceScaleFactor` 1.25).
- The comparison board scales the source sidebar crop to the implementation's 242 CSS px width before comparison.
- State: Ozon workspace selected; active and hover-capable navigation states preserved.
- Primary interaction checked: clicking the Ozon row changes the selected workspace and active row.
- Console checked: no application errors. Electron emitted only its development-mode Content Security Policy warning.

## Full-view comparison

- The desktop shell and existing glass design language remain unchanged outside the requested navigation region.
- The switcher now occupies two rows instead of one horizontal 1688 → Ozon flow, with labels pushed to the far edge of each row.
- Removing the bridge reduces visual noise without changing workspace behavior.

## Focused-region comparison

- Layout: passed. Both entries are vertical, full-width rows; logos are left aligned and `margin-left: auto` keeps labels flush right.
- Fonts and typography: passed. Labels use the existing UI font stack, 17 px optical size, strong navigation weight, and existing brand colors.
- Spacing and layout rhythm: passed. Both rows are 68 px high with equal 10 px vertical spacing, 14 px internal padding, and aligned 48 px logos.
- Colors and visual tokens: passed. 1688 uses the existing orange token, Ozon uses the existing accent blue, and the selected state keeps the established blue focus ring.
- Image quality and asset fidelity: passed. The existing raster brand assets are reused directly at 48 px with no placeholder, redraw, or generated replacement.
- Copy and content: passed. The visible labels and accessible names are `1688采集` and `OZON上架`.
- Responsiveness: passed for the existing desktop breakpoint. The sidebar continues to hide under the project's existing 860 px responsive rule.

## Findings

- No actionable P0, P1, or P2 visual differences remain in the requested region.
- P3: the two labels intentionally use their brand colors rather than the red annotation color, because red in the source is markup rather than product UI.

## Comparison history

1. Baseline: two logo-only buttons were arranged horizontally with a decorative bridge.
2. First implementation capture: the requested layout was correct, but public logo URLs did not resolve in the standalone QA `file://` harness.
3. QA harness correction: injected the repository's real PNG assets as data URLs for capture only; production source remains `/nav/1688.png` and `/nav/ozon.png`.
4. Post-fix comparison: both real assets render sharply, row geometry matches the requested structure, and no P0/P1/P2 mismatch remains.

## Implementation checklist

- [x] Stack the two workspace entries vertically.
- [x] Put each existing logo on the left and the requested text flush right.
- [x] Use `1688采集` and `OZON上架` as the visible and accessible labels.
- [x] Preserve active, hover, click, and responsive behavior.
- [x] Verify the real renderer build and compare the focused region against the annotated source.

final result: passed
