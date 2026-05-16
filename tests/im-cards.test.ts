import { describe, expect, it } from 'vitest';
import { decodeLastMessage } from '../src/session/im-cards.js';

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

describe('decodeLastMessage', () => {
  it('classifies contentType=1 as text and trims long previews', () => {
    const result = decodeLastMessage({
      content: { contentType: 1, text: { content: 'a'.repeat(300) } },
    });
    expect(result.kind).toBe('text');
    expect(result.preview).toHaveLength(200);
    expect(result.cardTemplate).toBeUndefined();
  });

  it('classifies contentType=2 as image', () => {
    const result = decodeLastMessage({ content: { contentType: 2 } });
    expect(result.kind).toBe('image');
    expect(result.preview).toBe('[图片]');
  });

  it('marks a message with no contentType as archived (server-stripped)', () => {
    // Reproduces the 1333 conversations we observed where the server omits
    // content for messages older than ~12 months.
    const result = decodeLastMessage({ content: {} });
    expect(result.kind).toBe('archived');
    expect(result.preview).toContain('归档');
  });

  it('marks an entirely missing message as archived', () => {
    expect(decodeLastMessage(undefined).kind).toBe('archived');
    expect(decodeLastMessage(null).kind).toBe('archived');
  });

  it('falls back to "other" with the raw contentType for unknown ints', () => {
    const result = decodeLastMessage({ content: { contentType: 999 } });
    expect(result.kind).toBe('other');
    expect(result.preview).toBe('[未知消息 ct=999]');
  });

  it('decodes an order_followup card (170002) with productTitle + orderId + amount', () => {
    // Exact shape captured from the live probe — 蜜可源头厂家 message.
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: {
          summary: '[卡片消息]',
          data: b64({
            imgUrl: 'http://cbu01.alicdn.com/img/ibank/abc.jpg',
            productTitle: '【厂价清仓】韩版针织钩花镂空三角巾',
            refundTitle: '亲，请尽快帮我发货！',
            linkUrl:
              'https://trade.1688.com/order/order_detail.htm?order_id=3301686771403783779',
            refundAmt: '订单金额：￥4.90',
          }),
        },
      },
      extension: { biMsgType: 'bc_0_170002_1622529928266' },
    });
    expect(result.kind).toBe('card');
    expect(result.cardTemplate).toBe('order_followup');
    expect(result.cardCode).toBe('170002');
    expect(result.preview).toBe('【厂价清仓】韩版针织钩花镂空三角巾');
    expect(result.extras?.orderId).toBe('3301686771403783779');
    expect(result.extras?.amount).toBe('订单金额：￥4.90');
    expect(result.extras?.imgUrl).toBe(
      'http://cbu01.alicdn.com/img/ibank/abc.jpg',
    );
    expect(result.extras?.linkUrl).toContain('order_id=3301686771403783779');
  });

  it('decodes an offer recommendation card (467001) from dynamic_msg_content', () => {
    // luxi1150339839 case — preview lives in extension.dynamic_msg_content,
    // content.custom is empty.
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: { summary: '', data: '', title: '' },
      },
      extension: {
        biMsgType: 'bc_0_467001_1743412976540',
        dynamic_msg_content: JSON.stringify([
          {
            platform: 1,
            templateData: {
              offerSubTitle: '本周上新',
              firstPartPrice: '0',
              secondPartPrice: '04',
              pcJumpUrl:
                'https://m.1688.com/offer/1049153442030.html?item_id=1049153442030',
              offerPic: 'https://cbu01.alicdn.com/img/ibank/xyz.jpg',
            },
          },
        ]),
      },
    });
    expect(result.kind).toBe('card');
    expect(result.cardTemplate).toBe('offer');
    expect(result.cardCode).toBe('467001');
    expect(result.preview).toBe('本周上新');
    expect(result.extras?.offerId).toBe('1049153442030');
    expect(result.extras?.amount).toBe('¥0.04');
    expect(result.extras?.imgUrl).toContain('cbu01.alicdn.com');
  });

  it('decodes a refund card (247001) and pulls refundId from the link', () => {
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: {
          summary: '订单待退货提醒',
          data: b64({
            linkUrl:
              'https://trade.1688.com/order/refund/assure_refund_detail.htm?refundId=TQ26457002',
          }),
        },
      },
      extension: { biMsgType: 'bc_0_247001_1234567890' },
    });
    expect(result.cardTemplate).toBe('refund');
    expect(result.preview).toBe('订单待退货提醒');
    expect(result.extras?.refundId).toBe('TQ26457002');
  });

  it('falls back to "unknown" cardTemplate when biMsgType code is unmapped', () => {
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: { summary: '某个新业务卡片', data: '' },
      },
      extension: { biMsgType: 'bc_0_999888_987654321' },
    });
    expect(result.kind).toBe('card');
    expect(result.cardTemplate).toBe('unknown');
    // Raw code still surfaced so agents can filter on it.
    expect(result.cardCode).toBe('999888');
    expect(result.preview).toBe('某个新业务卡片');
  });

  it('uses [卡片消息] when summary is the placeholder and no other field has text', () => {
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: { summary: '[卡片消息]', data: '' },
      },
      extension: { biMsgType: 'bc_0_339001_x' },
    });
    expect(result.preview).toBe('[卡片消息]');
  });

  it('prefers data.productTitle over the placeholder summary', () => {
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: {
          summary: '[卡片消息]',
          data: b64({ productTitle: '真实商品名' }),
        },
      },
      extension: { biMsgType: 'bc_0_170002_x' },
    });
    expect(result.preview).toBe('真实商品名');
  });

  it('omits extras when no fields resolved', () => {
    const result = decodeLastMessage({
      content: { contentType: 101, custom: { summary: 'plain' } },
      extension: { biMsgType: 'bc_0_352003_x' },
    });
    expect(result.extras).toBeUndefined();
  });

  it('survives malformed base64 or JSON in custom.data', () => {
    const result = decodeLastMessage({
      content: {
        contentType: 101,
        custom: { summary: 'fine', data: '!!not-base64!!' },
      },
      extension: { biMsgType: 'bc_0_170002_x' },
    });
    expect(result.kind).toBe('card');
    expect(result.preview).toBe('fine');
  });

  it('survives malformed dynamic_msg_content', () => {
    const result = decodeLastMessage({
      content: { contentType: 101, custom: { summary: 'fine' } },
      extension: {
        biMsgType: 'bc_0_467001_x',
        dynamic_msg_content: '{not json',
      },
    });
    expect(result.kind).toBe('card');
    expect(result.preview).toBe('fine');
  });

  it('handles missing biMsgType (cardCode undefined, cardTemplate=unknown)', () => {
    const result = decodeLastMessage({
      content: { contentType: 101, custom: { summary: 'x' } },
      extension: {},
    });
    expect(result.cardCode).toBeUndefined();
    expect(result.cardTemplate).toBe('unknown');
  });
});
