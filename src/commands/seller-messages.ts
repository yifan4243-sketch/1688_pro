import type { BrowserContext, FrameLocator, Page } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { execute as orderGetExecute } from './order-get.js';
import { readState } from '../session/state.js';

export interface SellerMessagesOpts {
  target: string;
  limit?: string;
  since?: string;
  profile?: string;
  headed?: boolean;
}

export interface SellerMessagesArgs {
  searchNames: string[];
  sellerLoginId?: string;
  orderId?: string;
  myLoginId: string;
  limit: number;
}

export interface Message {
  sender: string;
  time: string | null;
  isMine: boolean;
  content: string;
  read: boolean;
}

export interface SellerMessagesResult {
  conversation: string;
  total: number;
  messages: Message[];
}

const IM_BASE =
  'https://air.1688.com/app/ocms-fusion-components-1688/def_cbu_web_im/index.html';

export async function execute(
  ctx: BrowserContext,
  args: SellerMessagesArgs,
): Promise<SellerMessagesResult> {
  const page = await ctx.newPage();
  try {
    let url: string;
    if (args.sellerLoginId && args.orderId) {
      url =
        `${IM_BASE}?` +
        `touid=cnalichn${encodeURIComponent(args.sellerLoginId)}` +
        `&siteid=cnalichn` +
        `&status=1` +
        `&portalId=` +
        `&gid=` +
        `&offerId=` +
        `&itemsId=` +
        `&orderId=${encodeURIComponent(args.orderId)}` +
        `#/`;
      info(`Opening 旺旺 (order-scoped: orderId=${args.orderId})...`);
    } else {
      url = `${IM_BASE}?fromid=cnalichn${encodeURIComponent(args.myLoginId)}`;
      info('Opening 旺旺 IM (sidebar mode)...');
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
      throw new CliError(
        3,
        'NOT_LOGGED_IN',
        'Session expired. Run `1688 login`.',
      );
    }

    const imFrame: FrameLocator = page.frameLocator(
      'iframe[src*="def_cbu_web_im_core"]',
    );
    const input = imFrame.locator('pre.edit[contenteditable="true"]').first();
    try {
      await input.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      throw new CliError(
        22,
        'CHAT_NOT_LOADED',
        'Failed to open 旺旺 IM.',
      );
    }
    await new Promise((r) => setTimeout(r, 3000));

    // If sidebar mode: find + click the seller
    let matched: string | null = null;
    if (!args.sellerLoginId || !args.orderId) {
      for (const name of args.searchNames) {
        if (!name) continue;
        const item = imFrame.locator(`text=${name}`).first();
        if (await item.isVisible({ timeout: 2000 }).catch(() => false)) {
          await item.click({ force: true });
          matched = name;
          break;
        }
      }
      if (!matched) {
        throw new CliError(
          29,
          'SELLER_NOT_IN_SIDEBAR',
          `Seller not in 旺旺 sidebar: ${args.searchNames.join(', ')}. ` +
            'Use orderId instead to auto-activate via order context.',
        );
      }
    } else {
      matched = args.searchNames[0] ?? args.sellerLoginId;
    }

    // Wait for conversation panel to activate
    const activated = await page
      .waitForFunction(
        () => {
          const iframe = document.querySelector<HTMLIFrameElement>(
            'iframe[src*="def_cbu_web_im_core"]',
          );
          const body = iframe?.contentDocument?.body?.innerText ?? '';
          return !/您尚未选择联系人/.test(body) && body.length > 50;
        },
        { timeout: 25000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!activated) {
      throw new CliError(
        26,
        'CONVERSATION_NOT_SELECTED',
        `Conversation did not activate for ${matched}.`,
      );
    }
    await new Promise((r) => setTimeout(r, 2500)); // let messages render

    // Extract messages from .message-item elements
    const frame = page
      .frames()
      .find((f) => /def_cbu_web_im_core/.test(f.url()));
    if (!frame) {
      throw new CliError(22, 'CHAT_NOT_LOADED', 'IM iframe not available.');
    }
    const raw = await frame.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>('.message-item'),
      );
      return items.map((item) => {
        const cls = item.className?.toString?.() ?? '';
        const isMine = / self(\s|$)/.test(' ' + cls);
        const full = (item.innerText ?? '').replace(/\s+/g, ' ').trim();
        const tsRe = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/;
        const tsMatch = full.match(tsRe);
        const time = tsMatch ? tsMatch[1]! : null;
        let sender = '';
        let content = full;
        if (tsMatch) {
          sender = full.slice(0, tsMatch.index).trim();
          content = full.slice(tsMatch.index! + tsMatch[0].length).trim();
        }
        // Seller side shows "shop_name:operator_name" — keep just shop part.
        const colonIdx = sender.indexOf(':');
        const senderShort = colonIdx > -1 ? sender.slice(0, colonIdx) : sender;
        const read = /已读\s*$/.test(content);
        const cleanContent = content.replace(/\s*已读\s*$/, '').trim();
        return {
          sender: senderShort.trim(),
          time,
          isMine,
          content: cleanContent,
          read,
        };
      });
    });

    return {
      conversation: matched ?? '?',
      total: raw.length,
      messages: raw.slice(-Math.max(1, args.limit)),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function run(opts: SellerMessagesOpts): Promise<void> {
  if (!opts.target) {
    throw new CliError(2, 'BAD_INPUT', 'target required (orderId or seller name).');
  }
  const limit = Math.min(200, Math.max(1, parseInt(opts.limit ?? '20', 10)));
  const sinceMs = opts.since ? Date.parse(opts.since) : 0;

  const state = await readState();
  if (!state.nick) {
    throw new CliError(
      3,
      'NOT_LOGGED_IN',
      'Cannot determine your loginId. Run `1688 whoami`.',
    );
  }

  let args: SellerMessagesArgs;
  if (/^\d+$/.test(opts.target)) {
    info(`Looking up seller for order ${opts.target}...`);
    const order = await dispatch<
      { orderId: string; maxScanPages: number },
      Awaited<ReturnType<typeof orderGetExecute>>
    >(
      'order-get',
      { orderId: opts.target, maxScanPages: 5 },
      { headed: opts.headed, profile: opts.profile },
    );
    args = {
      searchNames: [order.seller.loginId, order.seller.name].filter(
        Boolean,
      ) as string[],
      sellerLoginId: order.seller.loginId ?? undefined,
      orderId: opts.target,
      myLoginId: state.nick,
      limit,
    };
  } else {
    args = {
      searchNames: [opts.target],
      myLoginId: state.nick,
      limit,
    };
  }

  let data = await dispatch<SellerMessagesArgs, SellerMessagesResult>(
    'seller-messages',
    args,
    { headed: opts.headed, profile: opts.profile },
  );

  // Apply --since filter
  if (sinceMs > 0) {
    data = {
      ...data,
      messages: data.messages.filter((m) => {
        if (!m.time) return false;
        const t = Date.parse(m.time.replace(' ', 'T') + '+08:00');
        return Number.isFinite(t) && t > sinceMs;
      }),
      total: data.messages.length,
    };
  }

  emit({
    human: () => printMessages(data),
    data,
  });
}

function printMessages(r: SellerMessagesResult): void {
  process.stdout.write(`Conversation: ${r.conversation}\n`);
  if (r.messages.length === 0) {
    process.stdout.write('  (no messages)\n');
    return;
  }
  for (const m of r.messages) {
    const who = m.isMine ? '我' : m.sender || '对方';
    const tail = m.read && m.isMine ? '  [已读]' : '';
    process.stdout.write(`  [${m.time ?? '?'}] ${who}: ${m.content}${tail}\n`);
  }
}
