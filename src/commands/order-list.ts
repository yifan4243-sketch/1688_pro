import type { BrowserContext, Response as PWResponse } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';

export interface OrderListOpts {
  status?: string;
  page?: string;
  pageSize?: string;
  profile?: string;
  headed?: boolean;
}

export interface OrderListArgs {
  status: string;
  page: number;
  pageSize: number;
  headed?: boolean;
}

export interface OrderListResult {
  status: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalOrders: number;
  orders: Order[];
}

export interface Order {
  orderId: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  confirmGoodsTime: string | null;
  totalAmount: number;
  productAmount: number;
  shipping: number;
  seller: {
    name: string;
    loginId: string;
    userId: string;
    shopUrl: string | null;
  };
  steps: OrderStep[];
  items: OrderItem[];
}

export interface OrderStep {
  status: string;
  name: string;
  paid: number;
  goods: number;
  postage: number;
}

export interface OrderItem {
  entryId: string;
  productName: string;
  spec: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  image: string | null;
  productNumber: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  all: '全部',
  waitbuyerpay: '待付款',
  waitsellersend: '待发货',
  waitbuyerreceive: '待收货',
  success: '已完成',
  cancel: '已取消',
};

const ORDER_LIST_URL =
  'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html';

const MTOP_API_RE = /mtop\.1688\.trading\.dataline\.service/i;

export async function execute(
  ctx: BrowserContext,
  args: OrderListArgs,
): Promise<OrderListResult> {
  const page = await ctx.newPage();

  let resolveCapture!: (v: unknown) => void;
  const captured = new Promise<unknown>((res) => {
    resolveCapture = res;
  });

  const onResp = async (resp: PWResponse) => {
    if (!MTOP_API_RE.test(resp.url())) return;
    try {
      const text = await resp.text();
      const outer = JSON.parse(text) as {
        data?: { data?: { result?: string } };
      };
      const resultStr = outer?.data?.data?.result;
      if (typeof resultStr !== 'string') return;
      const inner = JSON.parse(resultStr) as {
        data?: { data?: unknown[]; total?: number; pages?: number; pageSize?: number };
        success?: boolean;
      };
      const list = inner?.data?.data;
      if (!Array.isArray(list)) return;
      const first = list[0] as { id?: unknown } | undefined;
      if (list.length === 0 || (first && (first.id ?? null) !== null)) {
        resolveCapture(inner);
      }
    } catch {
      /* ignore non-JSON responses */
    }
  };
  page.on('response', onResp);

  const url = `${ORDER_LIST_URL}?tradeStatus=${encodeURIComponent(
    args.status,
  )}&page=${args.page}&pageSize=${args.pageSize}`;
  info(`Fetching orders (${args.status}, page ${args.page})...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      `Failed to load order page: ${(e as Error).message}`,
    );
  }

  if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
    throw new CliError(
      3,
      'NOT_LOGGED_IN',
      'Session expired. Run `1688 login`.',
    );
  }

  // Wait up to 25s for the mtop response carrying the order array.
  const inner = await Promise.race([
    captured,
    new Promise<null>((res) => setTimeout(() => res(null), 25000)),
  ]);
  page.off('response', onResp);
  await page.close().catch(() => {});

  if (!inner) {
    throw new CliError(
      11,
      'NO_ORDER_DATA',
      'Order list response was not captured (page may have changed or risk-controlled).',
    );
  }

  return parseOrderList(inner as RawList, args);
}

interface RawList {
  data?: {
    data?: unknown[];
    total?: number;
    pages?: number;
    pageSize?: number;
  };
}

function parseOrderList(
  inner: RawList,
  args: OrderListArgs,
): OrderListResult {
  const list = (inner.data?.data as RawOrder[] | undefined) ?? [];
  return {
    status: args.status,
    page: args.page,
    pageSize: inner.data?.pageSize ?? args.pageSize,
    totalPages: inner.data?.pages ?? 0,
    totalOrders: inner.data?.total ?? 0,
    orders: list.map(parseOrder),
  };
}

interface RawOrder {
  idStr?: string;
  id?: string | number;
  status?: string | number;
  statusLabel?: string;
  gmtCreate?: string;
  gmtPayment?: number;
  confirmGoodsTime?: number;
  carriage?: string;
  sumPayment?: string;
  sumProductPayment?: string;
  sellerInfo?: {
    companyName?: string;
    loginId?: string;
    userId?: string;
    companyUrl?: string;
  };
  newStepOrders?: RawStep[];
  orderEntries?: RawEntry[];
}

interface RawStep {
  stepStatus?: string;
  stepName?: string;
  payFee?: string;
  goodsFee?: string;
  postFee?: string;
  gmtPay?: number;
  gmtShip?: number;
}

interface RawEntry {
  entryId?: string | number;
  productName?: string;
  productNumber?: string;
  mainSummImageUrl?: string;
  actualUnitPrice?: string;
  amount?: string;
  quantity?: { realAmount?: number; realAmountStr?: string };
  specInfo?: { specItems?: { specName?: string; specValue?: string }[] };
}

function parseOrder(o: RawOrder): Order {
  const firstStep = o.newStepOrders?.[0];
  return {
    orderId: o.idStr ?? String(o.id ?? ''),
    status: firstStep?.stepStatus ?? String(o.status ?? ''),
    statusLabel: o.statusLabel ?? '',
    createdAt: o.gmtCreate ?? '',
    paidAt: o.gmtPayment ? new Date(o.gmtPayment).toISOString() : null,
    shippedAt: firstStep?.gmtShip
      ? new Date(firstStep.gmtShip).toISOString()
      : null,
    confirmGoodsTime: o.confirmGoodsTime
      ? new Date(o.confirmGoodsTime).toISOString()
      : null,
    totalAmount: cents(o.sumPayment),
    productAmount: cents(o.sumProductPayment),
    shipping: cents(o.carriage),
    seller: {
      name: o.sellerInfo?.companyName ?? '',
      loginId: o.sellerInfo?.loginId ?? '',
      userId: o.sellerInfo?.userId ?? '',
      shopUrl: o.sellerInfo?.companyUrl ?? null,
    },
    steps: (o.newStepOrders ?? []).map(parseStep),
    items: (o.orderEntries ?? []).map(parseEntry),
  };
}

function parseStep(s: RawStep): OrderStep {
  return {
    status: s.stepStatus ?? '',
    name: s.stepName ?? '',
    paid: cents(s.payFee),
    goods: cents(s.goodsFee),
    postage: cents(s.postFee),
  };
}

function parseEntry(e: RawEntry): OrderItem {
  const spec =
    e.specInfo?.specItems
      ?.map((s) => `${s.specName ?? ''}: ${s.specValue ?? ''}`)
      .join(' / ') ?? '';
  return {
    entryId: String(e.entryId ?? ''),
    productName: e.productName ?? '',
    spec,
    quantity: e.quantity?.realAmount ?? Number(e.quantity?.realAmountStr ?? 0),
    unitPrice: cents(e.actualUnitPrice),
    amount: cents(e.amount),
    image: e.mainSummImageUrl ?? null,
    productNumber: e.productNumber ?? null,
  };
}

function cents(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

export async function run(opts: OrderListOpts): Promise<void> {
  const status = opts.status ?? 'all';
  if (!(status in STATUS_LABELS)) {
    throw new CliError(
      2,
      'BAD_INPUT',
      `Unknown status "${status}". Valid: ${Object.keys(STATUS_LABELS).join(', ')}`,
    );
  }
  const pageNum = Math.max(1, parseInt(opts.page ?? '1', 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(opts.pageSize ?? '10', 10)));

  const data = await dispatch<OrderListArgs, OrderListResult>(
    'order-list',
    { status, page: pageNum, pageSize, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );

  emit({
    human: () => printOrders(data),
    data,
  });
}

function printOrders(r: OrderListResult): void {
  if (r.orders.length === 0) {
    process.stdout.write(
      `No orders found (status=${r.status}, page ${r.page}/${r.totalPages || 1}).\n`,
    );
    return;
  }
  const w = String(r.orders.length).length;
  r.orders.forEach((o, i) => {
    const idx = String(i + 1).padStart(w, ' ');
    const label = STATUS_LABELS[o.status] ?? o.status;
    process.stdout.write(
      `${idx}. ¥${o.totalAmount.toFixed(2)} · ${o.createdAt} · ${label}\n`,
    );
    const pad = ' '.repeat(w + 2);
    process.stdout.write(`${pad}from: ${o.seller.name} (${o.seller.loginId})\n`);
    for (const it of o.items) {
      process.stdout.write(
        `${pad}* ${it.quantity}×¥${it.unitPrice.toFixed(2)} = ¥${it.amount.toFixed(
          2,
        )} — ${truncate(it.productName, 40)}`,
      );
      if (it.spec) process.stdout.write(`  [${it.spec}]`);
      process.stdout.write('\n');
    }
    process.stdout.write(`${pad}orderId: ${o.orderId}\n`);
    if (i < r.orders.length - 1) process.stdout.write('\n');
  });
  process.stdout.write(
    `\nPage ${r.page} of ${r.totalPages} · ${r.totalOrders} total orders\n`,
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
