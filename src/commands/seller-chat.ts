import type { BrowserContext, FrameLocator, Page } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import { executeRaw as orderGetExecute } from './order-get.js';
import { readState } from '../session/state.js';

export interface SellerChatOpts {
  target?: string;
  message: string;
  prefix?: boolean;
  /** Skip sending order card link before message (use for follow-up replies) */
  noCard?: boolean;
  profile?: string;
  headed?: boolean;
}

export interface SellerChatArgs {
  /** Display name(s) to find seller in 旺旺 sidebar — try in order */
  searchNames: string[];
  /** Seller loginId (raw, no cnalichn prefix) for order/offer-context URL */
  sellerLoginId?: string;
  /** Order ID — passed in URL to trigger order-scoped conversation */
  orderId?: string;
  /** Offer ID — passed in URL to trigger pre-sale (offer-scoped) conversation */
  offerId?: string;
  myLoginId: string;
  message: string;
  headed?: boolean;
}

export interface SellerChatResult {
  ok: boolean;
  sentTo: string;
  message: string;
  sentAt: string;
}

const IM_BASE =
  'https://air.1688.com/app/ocms-fusion-components-1688/def_cbu_web_im/index.html';

export async function execute(
  ctx: BrowserContext,
  args: SellerChatArgs,
): Promise<SellerChatResult> {
  if (!args.message || !args.myLoginId || !args.searchNames?.length) {
    throw new CliError(
      2,
      'BAD_INPUT',
      'myLoginId, searchNames, and message are required.',
    );
  }
  if (args.message.length > 500) {
    throw new CliError(2, 'BAD_INPUT', 'Message too long (max 500 chars).');
  }

  return withRecovery(
    ctx,
    { cmd: 'seller-chat', args },
    () => executeRaw(ctx, args),
    { headed: args.headed === true, maxRetries: 0 },
  );
}

export async function executeRaw(
  ctx: BrowserContext,
  args: SellerChatArgs,
): Promise<SellerChatResult> {
  const page = await ctx.newPage();
  try {
    // Build URL using 1688's "联系卖家" pattern:
    //   touid=cnalichn<loginId>  (cnalichn prefix is required)
    //   siteid=cnalichn
    //   status=1
    //   orderId / offerId        (server uses these to scope/create conversation)
    //   #/
    //
    // Without proper scope params, 1688 won't create the conversation
    // server-side and the chat shows "您尚未选择联系人".
    let url: string;
    if (args.sellerLoginId && (args.orderId || args.offerId)) {
      url =
        `${IM_BASE}?` +
        `touid=cnalichn${encodeURIComponent(args.sellerLoginId)}` +
        `&siteid=cnalichn` +
        `&status=1` +
        `&portalId=` +
        `&gid=` +
        `&offerId=${args.offerId ? encodeURIComponent(args.offerId) : ''}` +
        `&itemsId=` +
        `&orderId=${args.orderId ? encodeURIComponent(args.orderId) : ''}` +
        `#/`;
      const scope = args.orderId
        ? `orderId=${args.orderId}`
        : `offerId=${args.offerId}`;
      info(`Opening 旺旺 (scoped: ${scope})...`);
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

    const imFrame = page.frameLocator('iframe[src*="def_cbu_web_im_core"]');
    const input = imFrame.locator('pre.edit[contenteditable="true"]').first();
    try {
      await input.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      throw new CliError(
        22,
        'CHAT_NOT_LOADED',
        'Failed to open 旺旺 IM (page never loaded chat input).',
      );
    }
    await new Promise((r) => setTimeout(r, 3000));

    // If scoped URL (order/offer) was used, conversation should auto-activate.
    // Otherwise (sidebar mode), find + click the seller in sidebar.
    let matchedName: string | null = null;
    if (args.sellerLoginId && (args.orderId || args.offerId)) {
      // Scoped — wait for auto-activation
      matchedName = args.searchNames[0] ?? args.sellerLoginId;
    } else {
      info(`Searching sidebar for: ${args.searchNames.join(' / ')}`);
      for (const name of args.searchNames) {
        if (!name) continue;
        const item = imFrame.locator(`text=${name}`).first();
        const visible = await item
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        if (visible) {
          info(`Found "${name}" in sidebar; clicking...`);
          await item.click({ force: true });
          matchedName = name;
          break;
        }
      }
      if (!matchedName) {
        throw new CliError(
          29,
          'SELLER_NOT_IN_SIDEBAR',
          `Seller not found in 旺旺 conversation list (tried: ${args.searchNames
            .filter(Boolean)
            .join(', ')}). Use an orderId-based call so we can pass orderId to ` +
            'auto-activate the conversation.',
        );
      }
    }

    // Wait for the conversation to actually activate (right pane no longer empty).
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
        `Conversation panel did not activate for ${matchedName}. ` +
          (args.orderId
            ? `OrderId ${args.orderId} was passed but conversation never opened.`
            : 'Sidebar click did not switch to conversation.'),
      );
    }
    await new Promise((r) => setTimeout(r, 1500));

    // 4. Type the message and send.
    info(`Typing message (${args.message.length} chars)...`);
    await input.click({ force: true });
    await input.fill('');
    await page.keyboard.type(args.message, { delay: 20 });
    await new Promise((r) => setTimeout(r, 500));

    info('Sending...');
    await imFrame
      .locator('button.send-btn:has-text("发送")')
      .first()
      .click({ force: true });

    // 5. Verify: input clears OR message appears in chat body
    const sentAt = new Date().toISOString();
    const sent = await page
      .waitForFunction(
        (msg) => {
          const iframe = document.querySelector<HTMLIFrameElement>(
            'iframe[src*="def_cbu_web_im_core"]',
          );
          const doc = iframe?.contentDocument;
          if (!doc) return false;
          const edit = doc.querySelector<HTMLElement>(
            'pre.edit[contenteditable="true"]',
          );
          const editText = (edit?.innerText ?? '').replace(/\s+/g, '');
          if (editText.length === 0) return true;
          const body = doc.body?.innerText ?? '';
          return body.includes(msg);
        },
        args.message,
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!sent) {
      throw new CliError(
        24,
        'SEND_UNCONFIRMED',
        'Send clicked but neither input cleared nor message appeared in scrollback.',
      );
    }

    return {
      ok: true,
      sentTo: matchedName,
      message: args.message,
      sentAt,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function run(opts: SellerChatOpts): Promise<void> {
  if (!opts.message) {
    throw new CliError(2, 'BAD_INPUT', 'Message is required.');
  }
  if (!opts.message.trim()) {
    throw new CliError(2, 'BAD_INPUT', 'Message cannot be empty.');
  }
  if (!opts.target) {
    throw new CliError(
      2,
      'BAD_INPUT',
      'Provide an orderId or seller name as target.',
    );
  }

  const state = await readState();
  if (!state.nick) {
    throw new CliError(
      3,
      'NOT_LOGGED_IN',
      'Cannot determine your loginId. Run `1688 whoami` first.',
    );
  }
  const myLoginId = state.nick;

  // For orderId target: look up seller; by default also send the order detail
  // URL as a first message (1688 IM auto-renders it as an order card).
  // --no-card skips the card (use for follow-up replies).
  // For loginId target: just send the text (sidebar mode).
  let baseArgs: Omit<SellerChatArgs, 'message'>;
  let sendCard = false;
  let finalMessage = opts.message;
  if (/^\d+$/.test(opts.target)) {
    info(`Looking up seller for order ${opts.target}...`);
    const order = await dispatch<
      { orderId: string; maxScanPages: number; headed?: boolean },
      Awaited<ReturnType<typeof orderGetExecute>>
    >(
      'order-get',
      { orderId: opts.target, maxScanPages: 5, headed: opts.headed },
      { headed: opts.headed, profile: opts.profile },
    );
    if (!order.seller.loginId) {
      throw new CliError(
        12,
        'SELLER_NOT_FOUND',
        `Order ${opts.target} has no seller loginId.`,
      );
    }
    baseArgs = {
      searchNames: [order.seller.loginId, order.seller.name].filter(
        Boolean,
      ) as string[],
      sellerLoginId: order.seller.loginId,
      orderId: opts.target,
      myLoginId,
    };
    sendCard = !opts.noCard;
    // Optional: --prefix adds 【订单 XXX】 in text (redundant if card sent)
    if (opts.prefix && !finalMessage.includes(opts.target)) {
      finalMessage = `【订单 ${opts.target}】${finalMessage}`;
    }
    info(`Will message: ${order.seller.name ?? order.seller.loginId}`);
  } else {
    baseArgs = {
      searchNames: [opts.target],
      myLoginId,
    };
    info(`Will message: ${opts.target} (sidebar mode — requires existing chat)`);
  }

  // First, send the order URL as a separate message (auto-rendered as card).
  if (sendCard) {
    const orderUrl = `https://trade.1688.com/order/new_step_order_detail.htm?orderId=${opts.target}`;
    info(`Sending message 1/2: order link card`);
    await dispatch<SellerChatArgs, SellerChatResult>(
      'seller-chat',
      { ...baseArgs, message: orderUrl, headed: opts.headed },
      { headed: opts.headed, profile: opts.profile },
    );
    await new Promise((r) => setTimeout(r, 1500));
    info(`Sending message 2/2: question`);
  }

  const data = await dispatch<SellerChatArgs, SellerChatResult>(
    'seller-chat',
    { ...baseArgs, message: finalMessage, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );

  emit({
    human: () => {
      process.stdout.write(`✓ Message sent to ${data.sentTo}\n`);
      process.stdout.write(`  at: ${data.sentAt}\n`);
      process.stdout.write(`  >> ${data.message}\n`);
    },
    data,
  });
}
