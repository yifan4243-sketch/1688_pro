#!/usr/bin/env node
import { Command } from 'commander';
import { CliError } from './io/errors.js';
import { setOutputFlags, isJson } from './io/output.js';
import updateNotifier from 'update-notifier';
import pkg from '../package.json' with { type: 'json' };

// Background check (once/day). On a TTY this prints a human banner.
// In JSON mode we surface a structured `_notice` line on stderr (see the
// preAction hook below) so agents can detect updates without parsing the
// banner.
const _notifier = updateNotifier({
  pkg,
  updateCheckInterval: 1000 * 60 * 60 * 24,
});
_notifier.notify({ defer: false, isGlobal: true });

const program = new Command();

program
  .name('1688')
  .description('1688 CLI for humans, Codex, and Claude Code')
  .version(pkg.version);

program
  .command('login')
  .description('Log in to 1688 by scanning a QR code (auto-starts daemon afterwards)')
  .option('--force', 'Re-login even if a session already exists')
  .option('--timeout <seconds>', 'Seconds to wait for QR scan', '300')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a real browser window instead of terminal QR')
  .option('--no-daemon', 'Do not auto-start the daemon after login')
  .action(async (opts) => {
    const { run } = await import('./commands/login.js');
    await run(opts);
  });

program
  .command('search')
  .description('Search 1688 by keyword')
  .argument('<keyword>', 'Keyword to search (use quotes for multi-word)')
  .option('--max <n>', 'Maximum number of results', '20')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a browser window (use to pass slider verification)')
  .action(async (keyword, opts) => {
    const { run } = await import('./commands/search.js');
    await run(keyword, opts);
  });

program
  .command('image-search')
  .description('Search 1688 by image (local file or http(s) URL)')
  .argument('<imagePathOrUrl>', 'Local file path OR http(s) image URL')
  .option('--max <n>', 'Maximum number of results', '20')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (imagePath, opts) => {
    const { run } = await import('./commands/image-search.js');
    await run({ ...opts, imagePath });
  });

program
  .command('offer')
  .description('Show details of a single 1688 offer')
  .argument('<offerId>', 'Offer ID (digits)')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a browser window (fallback for risk control)')
  .action(async (offerId, opts) => {
    const { run } = await import('./commands/offer.js');
    await run({ ...opts, offerId });
  });

program
  .command('similar')
  .description(
    'Find similar / 找同款 offers for a given offerId (compare suppliers, sorted by price)',
  )
  .argument('<offerId>', 'Offer ID (digits)')
  .option('--max <n>', 'Maximum number of similar offers', '20')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (offerId, opts) => {
    const { run } = await import('./commands/similar.js');
    await run({ ...opts, offerId });
  });

const seller = program
  .command('seller')
  .description('Seller communication (旺旺 IM)');

seller
  .command('inquire')
  .description(
    'Pre-sale inquiry: send a product link + question to seller (requires prior chat or --to)',
  )
  .argument('<offerId>', 'Offer ID (digits)')
  .argument('<message>', 'Question to ask (≤ 400 chars)')
  .option('--to <sellerLoginId>', 'Override seller lookup with explicit loginId')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (offerId, message, opts) => {
    const { run } = await import('./commands/seller-inquire.js');
    await run({ ...opts, offerId, message });
  });

seller
  .command('messages')
  .description('Read recent messages from a seller conversation')
  .argument('[target]', 'orderId (digits) OR seller loginId/name (omit if --offer)')
  .option('--offer <offerId>', 'Read pre-sale inquiry replies for this offerId')
  .option('--limit <n>', 'Max messages to return (default 20, max 200)', '20')
  .option(
    '--since <iso>',
    'Only show messages after this ISO timestamp (e.g. 2026-05-12T16:44:00+08:00)',
  )
  .option('--watch', 'Poll continuously and print new messages as they arrive')
  .option(
    '--interval <seconds>',
    'Polling interval in seconds for --watch (default 30, min 10)',
    '30',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (target, opts) => {
    const { run } = await import('./commands/seller-messages.js');
    await run({ ...opts, target });
  });

seller
  .command('chat')
  .description(
    'Send to seller. With orderId: sends order card link + message (use --no-card for follow-ups).',
  )
  .argument('<target>', 'orderId (digits) OR seller loginId/name')
  .argument('<message>', 'Message to send (≤ 500 chars)')
  .option(
    '--no-card',
    'Skip the order detail link card (for follow-up replies)',
  )
  .option(
    '--prefix',
    'Also prepend 【订单 XXX】 in message text',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (target, message, opts) => {
    const { run } = await import('./commands/seller-chat.js');
    await run({ ...opts, target, message });
  });

const checkout = program
  .command('checkout')
  .description('Checkout preview and confirmation (write operations)');

checkout
  .command('confirm')
  .description(
    'Place an order for selected cart items. Default: TTY+prompt. --agent: no prompt, daemon-OK.',
  )
  .argument('<cartIds...>', 'cartIds to checkout (from `1688 cart list`)')
  .option('-y, --yes', 'Skip y/N prompt (TTY still required)')
  .option(
    '--agent',
    'Agent mode: no prompts, may run via daemon. Use ONLY after user reviewed prepare.',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (cartIds, opts) => {
    const { run } = await import('./commands/checkout-confirm.js');
    await run({ ...opts, cartIds });
  });

checkout
  .command('prepare')
  .description('Preview total/address/items for a checkout (does NOT place order)')
  .argument('<cartIds...>', 'One or more cartIds from `1688 cart list`')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (cartIds, opts) => {
    const { run } = await import('./commands/checkout-prepare.js');
    await run({ ...opts, cartIds });
  });

const cart = program
  .command('cart')
  .description('1688 cart (采购车) operations');

cart
  .command('add')
  .description('Add one item to cart (UI replay, ~15s)')
  .argument('<offerId>', 'Offer ID (digits)')
  .requiredOption('--sku <skuId>', 'SKU ID (from `1688 offer <offerId>`)')
  .option('--qty <n>', 'Quantity', '1')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (offerId, opts) => {
    const { run } = await import('./commands/cart-add.js');
    await run({ ...opts, offerId });
  });

cart
  .command('remove')
  .description('Remove one item from cart by cartId (UI replay, ~10s)')
  .argument('<cartId>', 'Cart item ID (from `1688 cart list`)')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (cartId, opts) => {
    const { run } = await import('./commands/cart-remove.js');
    await run({ ...opts, cartId });
  });

cart
  .command('list')
  .description('List items in your cart')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { run } = await import('./commands/cart-list.js');
    await run(opts);
  });

program
  .command('shipped')
  .description('Combined order detail + logistics for one orderId')
  .argument('<orderId>', 'Order ID (digits)')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (orderId, opts) => {
    const { runShipped } = await import('./commands/workflows.js');
    await runShipped({ ...opts, orderId });
  });

program
  .command('stuck')
  .description('Orders paid but not shipped after N days (default 3)')
  .option('--days <n>', 'Threshold in days', '3')
  .option('--limit <n>', 'Max orders to return', '50')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { runStuck } = await import('./commands/workflows.js');
    await runStuck(opts);
  });

program
  .command('fake-shipped')
  .description('Orders marked shipped but logistics frozen at 等待揽收 (likely 虚假发货)')
  .option('--days <n>', 'Days threshold since shippedAt', '1')
  .option('--max-pages <n>', 'Order list pages to scan (50/page)', '2')
  .option('--max-check <n>', 'Max candidates to query logistics for', '20')
  .option('--limit <n>', 'Max flagged orders to return', '50')
  .option('--debug', 'Print logistics status/remark for each candidate')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { runFakeShipped } = await import('./commands/workflows.js');
    await runFakeShipped(opts);
  });

program
  .command('seller-history')
  .description('All orders from a seller + avg shipping days + on-time rate')
  .argument('<seller>', 'Seller loginId or company name (partial match OK)')
  .option('--max-pages <n>', 'Max order list pages to scan (50/page)', '10')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (seller, opts) => {
    const { runSellerHistory } = await import('./commands/workflows.js');
    await runSellerHistory({ ...opts, seller });
  });

const order = program
  .command('order')
  .description('Buyer order operations');

order
  .command('logistics')
  .description('Show shipping status + tracking number for an order')
  .argument('<orderId>', 'Order ID (digits)')
  .option('--max-scan-pages <n>', 'Max list pages to scan (50/page)', '5')
  .option(
    '--status <s>',
    'Narrow scan to one tradeStatus (waitbuyerreceive, waitsellersend, ...) — faster for heavy accounts',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (orderId, opts) => {
    const { run } = await import('./commands/order-logistics.js');
    await run({ ...opts, orderId });
  });

order
  .command('get')
  .description('Show one order by orderId (scans recent pages)')
  .argument('<orderId>', 'Order ID (digits)')
  .option('--max-scan-pages <n>', 'Max list pages to scan (50/page)', '5')
  .option(
    '--status <s>',
    'Narrow scan to one tradeStatus (waitbuyerreceive, ...) — faster for heavy accounts',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (orderId, opts) => {
    const { run } = await import('./commands/order-get.js');
    await run({ ...opts, orderId });
  });

order
  .command('list')
  .description('List buyer orders')
  .option(
    '--status <s>',
    'Filter: all | waitbuyerpay | waitsellersend | waitbuyerreceive | success | cancel',
    'all',
  )
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size (max 50)', '10')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { run } = await import('./commands/order-list.js');
    await run(opts);
  });

program
  .command('whoami')
  .description('Show the current logged-in account')
  .option('--verify', 'Verify the session online (slower)')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { run } = await import('./commands/whoami.js');
    await run(opts);
  });

program
  .command('logout')
  .description('Log out and clear local session')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { run } = await import('./commands/logout.js');
    await run(opts);
  });

program
  .command('doctor')
  .description('Check environment, profile, Chromium, and session')
  .option('--no-launch', 'Skip the actual Chromium launch test (faster)')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { run } = await import('./commands/doctor.js');
    await run(opts);
  });

program
  .command('serve')
  .description('Run the 1688 daemon in the foreground')
  .option('--idle-timeout <minutes>', 'Idle timeout in minutes', '30')
  .option('--no-prewarm', 'Skip pre-warming Chromium at startup')
  .action(async (opts) => {
    const { start } = await import('./daemon/server.js');
    await start({
      idleTimeoutMs: Math.max(1, parseInt(opts.idleTimeout, 10)) * 60_000,
      prewarm: opts.prewarm !== false,
    });
  });

const daemon = program
  .command('daemon')
  .description('Manage the background 1688 daemon');

daemon
  .command('start')
  .description('Start the daemon as a background process')
  .action(async () => {
    const { start } = await import('./daemon/manager.js');
    const { emit } = await import('./io/output.js');
    const { pid } = await start();
    emit({
      human: () => process.stdout.write(`Daemon started (pid ${pid}).\n`),
      data: { ok: true, pid },
    });
  });

daemon
  .command('stop')
  .description('Stop the running daemon')
  .action(async () => {
    const { stop } = await import('./daemon/manager.js');
    const { emit } = await import('./io/output.js');
    const { stopped } = await stop();
    emit({
      human: () =>
        process.stdout.write(stopped ? 'Daemon stopped.\n' : 'Daemon was not running.\n'),
      data: { ok: true, stopped },
    });
  });

daemon
  .command('reload')
  .description('Restart the daemon (stop + start) to pick up new code')
  .action(async () => {
    const fs = await import('node:fs/promises');
    const { stop, start, status } = await import('./daemon/manager.js');
    const { lockFile } = await import('./session/paths.js');
    const { emit, info } = await import('./io/output.js');
    const before = await status();
    if (before.running) {
      info('Stopping daemon...');
      await stop();
    }
    // Force-clean stale lock — we own the lifecycle here, so this is safe.
    // proper-lockfile sometimes leaves the `.lock.lock` dir behind if the daemon
    // exits before its release callback runs to completion.
    info('Cleaning stale lock...');
    await fs.rm(lockFile() + '.lock', { recursive: true, force: true });
    info('Starting daemon...');
    const { pid } = await start();
    emit({
      human: () => process.stdout.write(`Daemon reloaded (pid ${pid}).\n`),
      data: { ok: true, pid, wasRunning: before.running },
    });
  });

daemon
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const { status } = await import('./daemon/manager.js');
    const { emit } = await import('./io/output.js');
    const s = await status();
    emit({
      human: () => {
        if (!s.running) {
          process.stdout.write('Daemon: not running\n');
          return;
        }
        process.stdout.write(`Daemon: running (pid ${s.pid})\n`);
        if (s.reachable && s.stats && typeof s.stats === 'object') {
          const st = s.stats as Record<string, unknown>;
          process.stdout.write(`  uptime: ${Math.round((st.uptimeMs as number) / 1000)}s\n`);
          process.stdout.write(`  commands: ${st.commandCount}\n`);
          if (st.lastRequestAt) {
            process.stdout.write(`  last request: ${st.lastRequestAt}\n`);
          }
        }
      },
      data: s,
    });
  });

program
  .command('feedback')
  .description(
    'Submit feedback or a bug report. Default: opens a pre-filled GitHub issue. With --submit: posts directly via the `gh` CLI.',
  )
  // Variadic so macOS "smart quotes" can't truncate the message — words
  // are joined back together regardless of where the shell split them.
  .argument(
    '<message...>',
    'Your feedback or bug description (multiple words OK, quotes optional)',
  )
  .option('--bug', 'Tag the issue as a bug report')
  .option(
    '--submit',
    'Post the issue directly via the GitHub CLI (`gh`) — requires `gh auth login`',
  )
  .option('--no-open', 'Print the URL only; do not open a browser window')
  .action(async (messageParts: string[], opts) => {
    const { run } = await import('./commands/feedback.js');
    await run({ ...opts, message: messageParts.join(' ') });
  });

// Register the four output-shaping flags on every (sub)command so users
// don't have to remember a parent-command qualifier:
//   --json            Force JSON output even when stdout is a TTY.
//   --pretty          Pretty-print JSON (2-space indent).
//   --get <path>      Print one field by dot-path. Scalar → raw line,
//                     object/array → JSON. Supports a.b[0].c, arr[*].x
//                     (wildcards stream one line per element).
//   --pick <paths>    Comma-separated dot-paths → emit a JSON object with
//                     each path as a key.
//
// A preAction hook reads them via optsWithGlobals() and pushes into the
// output module before the command's run() calls emit().
function addOutputFlagsToAll(p: Command): void {
  for (const cmd of p.commands) {
    addOutputFlagsToAll(cmd);
    cmd.option('--json', 'Force JSON output even when stdout is a TTY');
    cmd.option('--pretty', 'Pretty-print JSON output (use with --json or pipe)');
    cmd.option(
      '--get <path>',
      'Print one field by dot-path (a.b[0].c, arr[*].x). Scalar → raw line, object/array → JSON',
    );
    cmd.option(
      '--pick <paths>',
      'Comma-separated dot-paths → emit a JSON object with each as a key',
    );
  }
}
addOutputFlagsToAll(program);

program.hook('preAction', (_thisCmd, actionCmd) => {
  const opts = actionCmd.optsWithGlobals() as {
    json?: boolean;
    pretty?: boolean;
    get?: string;
    pick?: string;
  };
  setOutputFlags({
    json: opts.json,
    pretty: opts.pretty,
    get: opts.get,
    pick: opts.pick,
  });

  // Agent-friendly update notice: in JSON mode, the human banner is
  // suppressed by update-notifier. Surface the same info as one line of
  // structured JSON on stderr so agents can detect updates programmatically.
  // See AGENTS.md → Update awareness.
  if (isJson() && _notifier.update) {
    const u = _notifier.update;
    process.stderr.write(
      JSON.stringify({
        _notice: 'updateAvailable',
        current: u.current,
        latest: u.latest,
        updateCommand: `npm i -g ${pkg.name}@latest`,
      }) + '\n',
    );
  }
});

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CliError) {
    if (e.message) process.stderr.write(`error: ${e.message}\n`);
    process.exit(e.exitCode);
  }
  const err = e as Error;
  const msg = err?.message ?? String(e);
  // Playwright surfaces these when the user closes the browser mid-flow.
  if (
    /Target page, context or browser has been closed/i.test(msg) ||
    /Browser closed|Target closed/i.test(msg)
  ) {
    process.stderr.write('error: Canceled (browser closed).\n');
    process.exit(130);
  }
  process.stderr.write(`unexpected: ${err.stack ?? msg}\n`);
  process.exit(1);
}
