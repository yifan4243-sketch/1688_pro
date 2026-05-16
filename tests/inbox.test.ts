import { describe, expect, it } from 'vitest';
import { parseConversations } from '../src/commands/inbox.js';

const MY = '1014787937';

function conv(opts: {
  cid: string;
  peerId: string;
  peerNick: string;
  unread?: number;
  topRank?: number;
  muted?: number;
  modifyTime: number;
  msg: {
    id: string;
    createAt: number;
    contentType: number;
    text?: string;
    senderUid: string;
  };
}) {
  return {
    type: 1,
    singleChatUserConversation: {
      redPoint: opts.unread ?? 0,
      topRank: opts.topRank ?? 0,
      muteNotification: opts.muted ?? 0,
      modifyTime: opts.modifyTime,
      lastMessage: {
        readStatus: opts.unread ? 0 : 2,
        message: {
          messageId: opts.msg.id,
          createAt: opts.msg.createAt,
          cid: opts.cid,
          content: {
            contentType: opts.msg.contentType,
            text: opts.msg.text ? { content: opts.msg.text } : undefined,
          },
          sender: { uid: `${opts.msg.senderUid}@cntaobao` },
        },
      },
      singleChatConversation: { cid: opts.cid },
      user_extension: {
        target: JSON.stringify({
          dnick: opts.peerNick,
          id: opts.peerId,
          snick: `cnalichn${opts.peerNick}`,
        }),
      },
    },
  };
}

describe('parseConversations', () => {
  it('parses a basic single-chat conversation', () => {
    const body = {
      nextCursor: 1778746086777,
      userConvs: [
        conv({
          cid: '1014787937.1-2218026418488.1#11152@cntaobao',
          peerId: '2218026418488',
          peerNick: '一六发发餐饮供应链',
          unread: 2,
          modifyTime: 1778839361239,
          msg: {
            id: '4114923753790.PNM',
            createAt: 1778839361179,
            contentType: 1,
            text: '亲亲，有什么需要',
            senderUid: '2219818988561',
          },
        }),
      ],
    };
    const { conversations, nextCursor } = parseConversations([body], MY);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      cid: '1014787937.1-2218026418488.1#11152@cntaobao',
      peer: { nick: '一六发发餐饮供应链', id: '2218026418488' },
      unread: 2,
      topRank: 0,
      muted: false,
      lastMessage: {
        kind: 'text',
        preview: '亲亲，有什么需要',
        fromMe: false,
      },
    });
    expect(conversations[0]!.updatedAt).toBe('2026-05-15T10:02:41.239Z');
    expect(nextCursor).toBe(1778746086777);
  });

  it('marks fromMe correctly when sender is me', () => {
    const body = {
      userConvs: [
        conv({
          cid: 'cid-self',
          peerId: '999',
          peerNick: 'someone',
          modifyTime: 1,
          msg: {
            id: 'm',
            createAt: 1,
            contentType: 1,
            text: 'hi',
            senderUid: MY,
          },
        }),
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations[0]!.lastMessage.fromMe).toBe(true);
  });

  it('uses user_extension.target for peer nick (not extension.targetMainNick)', () => {
    // Reproduces the case where the conversation was created from peer's side
    // and extension.selfNick / targetMainNick reflect the peer's perspective.
    const body = {
      userConvs: [
        conv({
          cid: 'cid-mirrored',
          peerId: '2218214067327',
          peerNick: '恩腾医疗器械有限公司', // dnick — the truth
          modifyTime: 1,
          msg: {
            id: 'm',
            createAt: 1,
            contentType: 1,
            text: '您好',
            senderUid: '2218214067327',
          },
        }),
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations[0]!.peer.nick).toBe('恩腾医疗器械有限公司');
    expect(conversations[0]!.peer.id).toBe('2218214067327');
  });

  it('classifies non-text content using the im-cards decoder', () => {
    // Detailed kind-by-kind coverage lives in im-cards.test.ts; this test
    // only asserts that parseConversations wires the decoder in correctly.
    const make = (ct: number) =>
      conv({
        cid: `cid-${ct}`,
        peerId: String(ct),
        peerNick: `peer${ct}`,
        modifyTime: ct,
        msg: { id: `m${ct}`, createAt: ct, contentType: ct, senderUid: '1' },
      });
    const body = { userConvs: [make(1), make(2), make(101), make(0), make(99)] };
    const { conversations } = parseConversations([body], MY);
    const byCid = Object.fromEntries(conversations.map((c) => [c.cid, c]));
    expect(byCid['cid-1']!.lastMessage.kind).toBe('text');
    expect(byCid['cid-2']!.lastMessage.kind).toBe('image');
    expect(byCid['cid-101']!.lastMessage.kind).toBe('card');
    // ct=0 → archived (no contentType in raw -> archived path)
    // The conv() helper writes contentType=0 explicitly; decoder treats
    // unknown non-1/2/101 ints as 'other'.
    expect(byCid['cid-0']!.lastMessage.kind).toBe('other');
    expect(byCid['cid-99']!.lastMessage.kind).toBe('other');
  });

  it('marks lastMessage with no contentType as archived', () => {
    // Server-stripped conversations (~12+ months old). Conv helper requires
    // contentType, so build the userConv inline.
    const body = {
      userConvs: [
        {
          type: 1,
          singleChatUserConversation: {
            redPoint: 0,
            modifyTime: 100,
            singleChatConversation: { cid: 'archived-cid' },
            lastMessage: {
              message: {
                messageId: 'm',
                createAt: 100,
                cid: 'archived-cid',
                content: {}, // no contentType
                sender: { uid: '1@cntaobao' },
              },
            },
            user_extension: {
              target: JSON.stringify({ dnick: 'old-peer', id: '1' }),
            },
          },
        },
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.lastMessage.kind).toBe('archived');
    expect(conversations[0]!.lastMessage.preview).toContain('归档');
  });

  it('exposes cardTemplate / cardCode / extras on decoded card conversations', () => {
    const cardData = Buffer.from(
      JSON.stringify({
        productTitle: '韩版针织钩花',
        linkUrl:
          'https://trade.1688.com/order/order_detail.htm?order_id=3301686771403783779',
        refundAmt: '订单金额：￥4.90',
      }),
      'utf8',
    ).toString('base64');
    const body = {
      userConvs: [
        {
          type: 1,
          singleChatUserConversation: {
            redPoint: 0,
            modifyTime: 100,
            singleChatConversation: { cid: 'card-cid' },
            lastMessage: {
              message: {
                messageId: 'm',
                createAt: 100,
                cid: 'card-cid',
                content: {
                  contentType: 101,
                  custom: { summary: '[卡片消息]', data: cardData },
                },
                extension: { biMsgType: 'bc_0_170002_xyz' },
                sender: { uid: '2@cntaobao' },
              },
            },
            user_extension: {
              target: JSON.stringify({ dnick: 'seller', id: '2' }),
            },
          },
        },
      ],
    };
    const { conversations } = parseConversations([body], MY);
    const lm = conversations[0]!.lastMessage;
    expect(lm.kind).toBe('card');
    expect(lm.cardTemplate).toBe('order_followup');
    expect(lm.cardCode).toBe('170002');
    expect(lm.preview).toBe('韩版针织钩花');
    expect(lm.extras?.orderId).toBe('3301686771403783779');
    expect(lm.extras?.amount).toBe('订单金额：￥4.90');
  });

  it('skips non-single-chat types', () => {
    const body = {
      userConvs: [
        { type: 2, singleChatUserConversation: {} }, // group, ignored
        conv({
          cid: 'kept',
          peerId: '1',
          peerNick: 'p',
          modifyTime: 1,
          msg: { id: 'm', createAt: 1, contentType: 1, text: 'x', senderUid: '1' },
        }),
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations.map((c) => c.cid)).toEqual(['kept']);
  });

  it('dedups by cid across multiple bodies (re-fetch case)', () => {
    const c = conv({
      cid: 'dup',
      peerId: '1',
      peerNick: 'p',
      modifyTime: 1,
      msg: { id: 'm', createAt: 1, contentType: 1, text: 'x', senderUid: '1' },
    });
    const { conversations } = parseConversations(
      [{ userConvs: [c] }, { userConvs: [c] }],
      MY,
    );
    expect(conversations).toHaveLength(1);
  });

  it('sorts pinned (topRank > 0) above non-pinned, then by updatedAt desc', () => {
    const body = {
      userConvs: [
        conv({
          cid: 'old',
          peerId: '1',
          peerNick: 'old',
          modifyTime: 100,
          msg: { id: 'm1', createAt: 100, contentType: 1, text: 'a', senderUid: '1' },
        }),
        conv({
          cid: 'pinned',
          peerId: '2',
          peerNick: 'pinned',
          topRank: 5,
          modifyTime: 50, // older but pinned
          msg: { id: 'm2', createAt: 50, contentType: 1, text: 'b', senderUid: '2' },
        }),
        conv({
          cid: 'new',
          peerId: '3',
          peerNick: 'new',
          modifyTime: 200,
          msg: { id: 'm3', createAt: 200, contentType: 1, text: 'c', senderUid: '3' },
        }),
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations.map((c) => c.cid)).toEqual(['pinned', 'new', 'old']);
  });

  it('handles missing user_extension.target by skipping', () => {
    const body = {
      userConvs: [
        {
          type: 1,
          singleChatUserConversation: {
            redPoint: 0,
            modifyTime: 1,
            singleChatConversation: { cid: 'no-target' },
            lastMessage: {
              message: {
                messageId: 'm',
                createAt: 1,
                content: { contentType: 1, text: { content: 'x' } },
                sender: { uid: '1@cntaobao' },
              },
            },
            // no user_extension.target
          },
        },
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations).toHaveLength(0);
  });

  it('image kind gets sensible preview placeholder', () => {
    const body = {
      userConvs: [
        conv({
          cid: 'img',
          peerId: '1',
          peerNick: 'p',
          modifyTime: 1,
          msg: { id: 'm', createAt: 1, contentType: 2, senderUid: '1' },
        }),
      ],
    };
    const { conversations } = parseConversations([body], MY);
    expect(conversations[0]!.lastMessage.preview).toBe('[图片]');
  });
});
