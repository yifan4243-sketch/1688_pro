// Routes a command either through the daemon (fast) or inline (slow but
// self-contained). Headed mode and explicit `--profile` always go inline.

import type { BrowserContext } from 'playwright';
import { withSession } from './context.js';
import { isDaemonReachable, daemonCall } from '../daemon/client.js';
import { info } from '../io/output.js';

export interface DispatchOpts {
  headed?: boolean;
  profile?: string;
  noDaemon?: boolean;
}

type Executor<TArgs, TData> = (
  ctx: BrowserContext,
  args: TArgs,
) => Promise<TData>;

// Lazy-imported registry of command executors. Each entry must export `execute`.
// login/logout are deliberately omitted — they have interactive flows (QR render,
// stdin confirmation) that don't transit cleanly through a socket; they stay inline.
const REGISTRY: Record<string, () => Promise<Executor<unknown, unknown>>> = {
  search: () =>
    import('../commands/search.js').then((m) => m.execute as Executor<unknown, unknown>),
  whoami: () =>
    import('../commands/whoami.js').then((m) => m.execute as Executor<unknown, unknown>),
  'order-list': () =>
    import('../commands/order-list.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'order-get': () =>
    import('../commands/order-get.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'order-logistics': () =>
    import('../commands/order-logistics.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  offer: () =>
    import('../commands/offer.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'image-search': () =>
    import('../commands/image-search.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'cart-list': () =>
    import('../commands/cart-list.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'cart-remove': () =>
    import('../commands/cart-remove.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'cart-add': () =>
    import('../commands/cart-add.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'checkout-prepare': () =>
    import('../commands/checkout-prepare.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'checkout-confirm': () =>
    import('../commands/checkout-confirm.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'seller-chat': () =>
    import('../commands/seller-chat.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'seller-messages': () =>
    import('../commands/seller-messages.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
  'detail-feglobals': () =>
    import('../commands/seller-inquire.js').then(
      (m) => m.scrapeFeGlobals as Executor<unknown, unknown>,
    ),
  similar: () =>
    import('../commands/similar.js').then(
      (m) => m.execute as Executor<unknown, unknown>,
    ),
};

export async function loadExecutor<TArgs, TData>(
  name: string,
): Promise<Executor<TArgs, TData>> {
  const loader = REGISTRY[name];
  if (!loader) throw new Error(`Unknown command: ${name}`);
  return (await loader()) as Executor<TArgs, TData>;
}

export async function dispatch<TArgs, TData>(
  name: string,
  args: TArgs,
  opts: DispatchOpts = {},
): Promise<TData> {
  const skipDaemon =
    opts.headed === true ||
    !!opts.profile ||
    opts.noDaemon === true ||
    process.env.BB1688_NO_DAEMON === '1';

  if (!skipDaemon) {
    // Auto-start daemon if not running. Keeps the "warm browser" promise
    // after `npm i -g` (postinstall kills the daemon) without requiring the
    // user to re-run `1688 login` or `daemon start` manually.
    if (!(await isDaemonReachable())) {
      try {
        const { start } = await import('../daemon/manager.js');
        info('Starting daemon (one-time)...');
        await start();
      } catch {
        // Couldn't start — fall through to inline.
      }
    }
    if (await isDaemonReachable()) {
      try {
        return await daemonCall<TData>(name, args);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code && code !== 'ECONNREFUSED' && code !== 'ENOENT') throw e;
      }
    }
  }

  // Inline path. If a daemon is alive, it holds the lock — we must pause it
  // for the duration so this inline call can grab the lock and open its own
  // browser context on the shared profile. Restart on exit.
  const daemonMgr = await maybePauseDaemon();
  try {
    const fn = await loadExecutor<TArgs, TData>(name);
    return await withSession(
      { headless: !opts.headed, profile: opts.profile },
      (ctx) => fn(ctx, args),
    );
  } finally {
    await daemonMgr.resume();
  }
}

async function maybePauseDaemon(): Promise<{ resume: () => Promise<void> }> {
  try {
    const { status, stop, start } = await import('../daemon/manager.js');
    const st = await status();
    if (!st.running) return { resume: async () => {} };
    info('Pausing daemon for inline run...');
    await stop();
    return {
      resume: async () => {
        try {
          info('Resuming daemon...');
          await start();
        } catch (e) {
          info(`(Daemon resume failed: ${(e as Error).message})`);
        }
      },
    };
  } catch {
    return { resume: async () => {} };
  }
}
