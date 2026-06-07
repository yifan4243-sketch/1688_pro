import { EventEmitter } from 'node:events';
import type { Page, Response as PWResponse } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  buildCompanySearchUrl,
  makeSupplierSearchItem,
  parseSupplierEnrichTop,
  supplierItemsToCsv,
} from '../src/commands/supplier-search.js';
import {
  COMPANY_SEARCH_SERVICE,
  parseCompanySearchServiceText,
  parseSupplierItemsFromCompanySearchText,
  readSupplierSearchRequestMeta,
  startSupplierSearchCapture,
} from '../src/session/supplier-search.js';

class MockPage extends EventEmitter {
  on(event: 'response', listener: (response: PWResponse) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  off(event: 'response', listener: (response: PWResponse) => void): this;
  off(event: 'close', listener: () => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  emitResponse(response: PWResponse): void {
    this.emit('response', response);
  }
}

function page(): Page & MockPage {
  return new MockPage() as Page & MockPage;
}

function response(url: string, body: string): PWResponse {
  return {
    url: () => url,
    text: async () => body,
  } as unknown as PWResponse;
}

function companySearchUrl(pageNum = 1): string {
  return `https://search.1688.com/service/${COMPANY_SEARCH_SERVICE}?keywords=%BC%FC%C5%CC&async=true&asyncCount=14&beginPage=${pageNum}&pageSize=20&pageName=supplier`;
}

function serviceBody(names: string[]): string {
  return JSON.stringify({
    data: {
      code: 200,
      msg: 'ok',
      data: {
        pageCount: 50,
        docsReturn: names.length,
        companyWithOfferLists: names.map((name, i) => ({
          businessInspection: i === 0,
          factoryInspection: i === 0,
          factoryTag: i === 0 ? '产地工厂' : '',
          superFactory: false,
          safePurchase: i === 0,
          trust: i === 0,
          memberBookedCount: 30 + i,
          fuzzyPayOrdAmt3m: '400万+',
          companyModel: {
            company: name,
            loginId: `login${i}`,
            userId: `b2b-2771385863${i}be42`,
            enterpriseId: `a-b2b-2771385863${i}be42`,
            realUserId: `2771385863${i}`,
            id: 669929411946 + i,
            domainUri: `shop${i}.1688.com`,
            province: '广东',
            city: '深圳',
            address: '华强北赛格电子市场8楼8023',
            latitude: '22.5414',
            longitude: '114.088',
            productionService: 'U盘;键盘;光驱、刻录机',
            businessMode: '2',
            memberLevel: 'PM',
            tpServiceYear: '10',
            tpNum: 1,
            factoryLevel: i === 0 ? '无牌工厂' : '',
            isFactory: i === 0 ? 'N' : 'N',
            compositeNewScore: '4.0',
            wwResponseRate: '0.62',
            repeatRate: '0.39',
            complianceRate: '-1',
            payMordCnt3Month: 117,
            payOrdAmt3m: '4220250',
            saleQuantity3Month: '113',
            memberTags: '源头工厂;买家保障',
          },
          companyOffers: [
            {
              bookedCount: 233,
              brief: '品牌:中性',
              detailUrl: 'https://detail.1688.com/offer/669929411946.html',
              picUrl: '//cbu01.alicdn.com/img/ibank/example.jpg',
              price: 28,
              quantitySumMonth: 0,
              saleQuantity: 1451,
              subject: 'TT-A01 迷你有线多媒体键盘',
              unit: '个',
            },
          ],
        })),
      },
    },
    requestId: 'req-1',
    pageName: 'supplier',
    rtTime: 123,
  });
}

describe('supplier company search helpers', () => {
  it('builds company-search URLs with GBK keywords', () => {
    expect(buildCompanySearchUrl('键盘')).toBe(
      'https://s.1688.com/company/company_search.htm?keywords=%BC%FC%C5%CC',
    );
  });

  it('reads company search request metadata', () => {
    expect(readSupplierSearchRequestMeta(companySearchUrl(3))).toMatchObject({
      beginPage: 3,
      pageSize: 20,
      pageName: 'supplier',
    });
  });

  it('maps companySearchBusinessService suppliers and offer previews', () => {
    const data = parseCompanySearchServiceText(serviceBody(['深圳市福田区麦寇电子经营部']));

    expect(data).toMatchObject({
      pageCount: 50,
      docsReturn: 1,
      code: 200,
      message: 'ok',
      requestId: 'req-1',
    });
    expect(data.suppliers[0]).toMatchObject({
      companyName: '深圳市福田区麦寇电子经营部',
      loginId: 'login0',
      memberId: 'b2b-27713858630be42',
      enterpriseId: 'a-b2b-27713858630be42',
      shopUrl: 'https://shop0.1688.com',
      factoryCardUrl:
        'https://sale.1688.com/factory/card.html?memberId=b2b-27713858630be42',
      location: { province: '广东', city: '深圳', latitude: 22.5414 },
      productionService: 'U盘;键盘;光驱、刻录机',
      tp: { serviceYears: 10 },
      factory: { isFactory: true, factoryTag: '产地工厂' },
      service: { compositeScore: 4, wwResponseRate: 0.62, repeatRate: 0.39 },
      demand: { payOrderCount3m: 117, payAmount3m: 4220250 },
    });
    expect(data.suppliers[0]?.offersPreview[0]).toMatchObject({
      offerId: '669929411946',
      title: 'TT-A01 迷你有线多媒体键盘',
      url: 'https://detail.1688.com/offer/669929411946.html',
      price: { text: '¥28', value: 28 },
      image: 'https://cbu01.alicdn.com/img/ibank/example.jpg',
    });
    expect(parseSupplierItemsFromCompanySearchText(serviceBody(['A']))).toHaveLength(1);
  });

  it('keeps the largest company-search response during capture', async () => {
    const mockPage = page();
    const capture = startSupplierSearchCapture({
      page: mockPage,
      targetPage: () => 1,
      keep: 'largest',
    });

    const result = await capture.waitForAction(
      async () => {
        mockPage.emitResponse(response(companySearchUrl(1), serviceBody(['one'])));
        mockPage.emitResponse(response(companySearchUrl(2), serviceBody(['wrong-page'])));
        mockPage.emitResponse(response(companySearchUrl(1), serviceBody(['one', 'two'])));
      },
      { timeoutMs: 50, intervalMs: 1, settleMs: 1 },
    );

    expect(result.status).toBe('captured');
    expect(result.data?.suppliers.map((s) => s.companyName)).toEqual(['one', 'two']);
    expect(result.diagnostics).toMatchObject({
      matchedCount: 2,
      parsedCount: 2,
    });
    expect(mockPage.listenerCount('response')).toBe(0);
    expect(mockPage.listenerCount('close')).toBe(0);
  });

  it('scores and exports supplier research rows', () => {
    const supplier = parseSupplierItemsFromCompanySearchText(serviceBody(['A, B "quoted"']))[0];
    expect(supplier).toBeTruthy();
    const item = makeSupplierSearchItem('键盘', 1, supplier!);
    item.globalRank = 1;

    expect(item.score).toBeGreaterThan(0);
    expect(supplierItemsToCsv([item])).toContain('"A, B ""quoted"""');
  });

  it('parses supplier enrichment limits', () => {
    expect(parseSupplierEnrichTop(undefined, 'top:10')).toBe(10);
    expect(parseSupplierEnrichTop('none', 'top:10')).toBe(0);
    expect(parseSupplierEnrichTop('all', '0')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
