# Desktop Build Guide — 1688 to Ozon Studio

## Architecture

```
┌─ Electron Main Process (apps/desktop/main/main.cjs) ──────────┐
│  cli-resolver.cjs — dev / packaged CLI path resolution         │
│  IPC handlers — commands, accounts, runtime                    │
│  Reuses: apps/desktop/cli-bridge.cjs, apps/desktop/accounts.cjs│
└────────────────────────────┬───────────────────────────────────┘
                             │ preload (apps/desktop/preload/preload.cjs)
┌─ React Renderer (apps/desktop/renderer/) ──────────────────────┐
│  Vite + React + TypeScript                                      │
│  Components: AccountSelector, RuntimeStatusPanel, CommandPanel  │
│  API wrapper: src/services/api.ts                              │
└────────────────────────────────────────────────────────────────┘
```

CLI is the built-in execution engine. Employees never interact with CLI directly.

## Dev Mode

```bash
npm run desktop:dev
```

1. Starts Vite dev server at http://localhost:5173
2. Starts Electron loading the dev URL
3. CLI path: `dist/cli.js` in project root

## Build

```bash
npm run build              # Build TypeScript CLI → dist/cli.js
npm run desktop:build      # Build CLI + Vite React renderer
```

## Pack (local exe, no installer)

```bash
npm run desktop:pack
```

Output: `release/win-unpacked/1688 to Ozon Studio.exe`

## Dist (Windows installer)

```bash
npm run desktop:dist
```

Output: `release/1688 to Ozon Studio Setup.exe`

## Bundled CLI Path

| Mode | Path |
|---|---|
| Dev | `<project-root>/dist/cli.js` |
| Packaged | `process.resourcesPath/cli/dist/cli.js` |

electron-builder `extraResources` copies `dist/` → `resources/cli/dist/`.

## External Dependencies

The packaged app bundles `node_modules/` including:
- `commander`
- `playwright` / `playwright-extra` / `puppeteer-extra-plugin-stealth`
- `proper-lockfile`
- `qrcode`
- `iconv-lite`
- `update-notifier`

**Chrome requirement**: Playwright needs a system Chrome or Chromium. The packaged
app does NOT bundle a full Chromium (~150 MB). Employees must have Google Chrome or
Microsoft Edge installed. The packaged app detects system Chrome via `channel: 'chrome'`.

## Employee Workflow

1. Download `1688 to Ozon Studio Setup.exe`
2. Install and launch
3. Select "默认账号" or add a new account via "新增登录账号"
4. Click "登录 / 重新登录" (opens a Chrome window for QR scan)
5. Choose a command (e.g., "搜索词采集")
6. Fill in search keyword and options
7. Click "执行命令"
8. Results appear below; history available in the right panel

## Old Files (kept for backward compat)

The following files from before the React migration are kept but no longer used
by the main Electron process:

- `apps/desktop/main.cjs` (replaced by `apps/desktop/main/main.cjs`)
- `apps/desktop/preload.cjs` (replaced by `apps/desktop/preload/preload.cjs`)
- `apps/desktop/index.html` (replaced by `apps/desktop/renderer/index.html`)
- `apps/desktop/renderer.js` (replaced by `apps/desktop/renderer/src/`)
- `apps/desktop/styles.css` (replaced by `apps/desktop/renderer/src/App.css`)

The CLI bridge and accounts modules are still shared:

- `apps/desktop/cli-bridge.cjs` — still used by new main process
- `apps/desktop/accounts.cjs` — still used by new main process
