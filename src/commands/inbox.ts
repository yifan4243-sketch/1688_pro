import type { BrowserContext } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { CliError } from '../io/errors.js';
import { emit, info } from '../io/output.js';
import { findImInput } from '../session/im-locators.js';
import {
  IM_BASE,
  collectWsFrames,
  dumpWsFramesForProbe,
  findLwpResponses,
  waitForLwpResponse,
} from '../session/im-ws.js';
import { withRecovery } from '../session/recovery.js';
import { readState } from '../session/state.js';
import { sleep } from '../session/wait.js';

const LWP_LIST = '/r/Conversation/listNewestPagination';
const LWP_LIST_TOP = '/r/Conversation/listTop';

export interface InboxOpts {
  limit?: string;
  unread?: boolean;
  profile?: string;
  headed?: boolean;
}

export interface InboxArgs {
  limit: number;
  unreadOnly: boolean;
  myLoginId: string;
  myMemberId: string;
  headed?: boolean;
}

export type MessageKind = 'text' | 'image' | 'card' | 'system' | 'other';

export interface Conversation {
  cid: string;
  peer: { nick: string; id: string };
  unread: number;
  topRank: number;
  muted: boolean;
  updatedAt: string;
  lastMessage: {
    messageId: string | null;
    kind: MessageKind;
    preview: string;
    at: string | null;
    fromMe: boolean;
  };
}

export interface InboxResult {
  myLoginId: string;
  myMemberId: string;
  conversations: Conversation[];
  nextCursor: number | null;
  truncated: boolean;
}

interface LwpListBody {
  nextCursor?: number;
  userConvs?: LwpUserConv[];
}

interface LwpUserConv {
  type?: number;
  singleChatUserConversation?: {
    redPoint?: number;
    modifyTime?: number;
    topRank?: number;
    muteNotification?: number;
    lastMessage?: {
      readStatus?: number;
      message?: {
        messageId?: string | number;
        createAt?: number;
        cid?: string;
        content?: {
          contentType?: number;
          text?: { content?: string };
          [k: string]: unknown;
        };
        sender?: { uid?: string };
      };
    };
    singleChatConversation?: { cid?: string };
    user_extension?: { target?: string };
  };
}

export function parseConversations(
  bodies: LwpListBody[],
  myMemberId: string,
): { conversations: Conversation[]; nextCursor: number | null } {
  const seen = new Set<string>();
  const out: Conversation[] = [];
  let cursor: number | null = null;

  // Use the LATEST response if duplicates fired (IM client occasionally
  // re-fetches). nextCursor comes from the last body received.
  for (const body of bodies) {
    if (typeof body.nextCursor === 'number') cursor = body.nextCursor;
    if (!Array.isArray(body.userConvs)) continue;
    for (const u of body.userConvs) {
      if (u.type !== 1) continue; // single-chat only for v1
      const s = u.singleChatUserConversation;
      if (!s) continue;
      const cid = s.singleChatConversation?.cid ?? s.lastMessage?.message?.cid;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);

      const peer = parsePeer(s.user_extension?.target);
      if (!peer) continue;

      const msg = s.lastMessage?.message;
      const content = msg?.content;
      const kind = classifyKind(content);
      const preview = extractPreview(content, kind);
      const senderUid = (msg?.sender?.uid ?? '').split('@')[0] ?? '';
      const fromMe = senderUid === myMemberId;

      out.push({
        cid,
        peer,
        unread: s.redPoint ?? 0,
        topRank: s.topRank ?? 0,
        muted: (s.muteNotification ?? 0) === 1,
        updatedAt: msEpochToIso(s.modifyTime) ?? '',
        lastMessage: {
          messageId: msg?.messageId != null ? String(msg.messageId) : null,
          kind,
          preview,
          at: msEpochToIso(msg?.createAt),
          fromMe,
        },
      });
    }
  }

  // Pinned (topRank > 0) bubble to top, then by updatedAt desc.
  out.sort((a, b) => {
    if (a.topRank !== b.topRank) return b.topRank - a.topRank;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  return { conversations: out, nextCursor: cursor };
}

function parsePeer(targetStr?: string): { nick: string; id: string } | null {
  if (!targetStr) return null;
  try {
    const t = JSON.parse(targetStr) as { dnick?: string; id?: string };
    if (!t.id) return null;
    return { nick: t.dnick ?? t.id, id: t.id };
  } catch {
    return null;
  }
}

function classifyKind(content: { contentType?: number } | undefined): MessageKind {
  const ct = content?.contentType;
  if (ct === 1) return 'text';
  if (ct === 2) return 'image';
  if (ct === 102 || ct === 105) return 'card';
  return 'other';
}

function extractPreview(
  content: { text?: { content?: string }; [k: string]: unknown } | undefined,
  kind: MessageKind,
): string {
  if (!content) return '';
  if (kind === 'text') {
    return (content.text?.content ?? '').slice(0, 200);
  }
  if (kind === 'image') return '[图片]';
  if (kind === 'card') return '[卡片]';
  return '[非文本消息]';
}

function msEpochToIso(ms?: number): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

export async function execute(
  ctx: BrowserContext,
  args: InboxArgs,
): Promise<InboxResult> {
  return withRecovery(
    ctx,
    { cmd: 'inbox', args },
    () => executeRaw(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

export async function executeRaw(
  ctx: BrowserContext,
  args: InboxArgs,
): Promise<InboxResult> {
  const page = await ctx.newPage();
  const frames = collectWsFrames(page);

  try {
    const url = `${IM_BASE}?fromid=cnalichn${encodeURIComponent(args.myLoginId)}`;
    info('Opening 旺旺 IM (inbox mode)...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
      throw new CliError(
        3,
        'NOT_LOGGED_IN',
        'Session expired. Run `1688 login`.',
      );
    }

    // Wait for IM iframe to mount (input visible = WS handshake done +
    // initial inbox fetch in-flight).
    await findImInput(page);

    // The IM client auto-fires listNewestPagination on load. Wait for it.
    const got = await waitForLwpResponse(frames, LWP_LIST, 12000);
    if (got) {
      // Tiny grace window in case of a re-fetch.
      await sleep(400);
    } else {
      // No response yet — give DOM/WS a bit more time.
      await sleep(2000);
    }

    dumpWsFramesForProbe(frames);

    const listBodies = findLwpResponses<LwpListBody>(frames, LWP_LIST);
    const topBodies = findLwpResponses<LwpListBody>(frames, LWP_LIST_TOP);
    const allBodies = [...topBodies, ...listBodies];
    if (allBodies.length === 0) {
      throw new CliError(
        24,
        'IM_INBOX_EMPTY',
        'IM inbox response not captured. Try --headed to debug.',
        { category: 'capture', currentUrl: page.url(), retryable: true },
      );
    }
    const { conversations, nextCursor } = parseConversations(
      allBodies,
      args.myMemberId,
    );

    let filtered = conversations;
    if (args.unreadOnly) filtered = filtered.filter((c) => c.unread > 0);
    const truncated = filtered.length > args.limit;
    if (truncated) filtered = filtered.slice(0, args.limit);

    return {
      myLoginId: args.myLoginId,
      myMemberId: args.myMemberId,
      conversations: filtered,
      nextCursor,
      truncated,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function run(opts: InboxOpts): Promise<void> {
  const limit = Math.min(200, Math.max(1, parseInt(opts.limit ?? '20', 10)));
  const state = await readState();
  if (!state.nick || !state.memberId) {
    throw new CliError(
      3,
      'NOT_LOGGED_IN',
      'Cannot determine your loginId/memberId. Run `1688 whoami` first.',
    );
  }

  const data = await dispatch<InboxArgs, InboxResult>(
    'inbox',
    {
      limit,
      unreadOnly: !!opts.unread,
      myLoginId: state.nick,
      myMemberId: state.memberId,
      headed: opts.headed,
    },
    { headed: opts.headed, profile: opts.profile },
  );

  emit({
    human: () => {
      process.stdout.write(
        `Inbox (${data.conversations.length}${data.truncated ? '+' : ''}):\n`,
      );
      if (data.conversations.length === 0) {
        process.stdout.write('  (empty)\n');
        return;
      }
      for (const c of data.conversations) {
        const unread = c.unread > 0 ? `[${c.unread}]` : '   ';
        const pin = c.topRank > 0 ? '📌' : '  ';
        const time = c.updatedAt ? c.updatedAt.slice(11, 16) : '--:--';
        const me = c.lastMessage.fromMe ? '(我)' : '';
        process.stdout.write(
          `  ${pin} ${unread} ${time}  ${c.peer.nick.padEnd(20).slice(0, 20)}  ${me}${c.lastMessage.preview.slice(0, 50)}\n`,
        );
        process.stdout.write(`         cid: ${c.cid}\n`);
      }
      if (data.nextCursor) {
        process.stdout.write(
          `\n(more available — pagination not yet implemented)\n`,
        );
      }
    },
    data: { ok: true, data },
  });
}
