import type { BrowserContext, Page, Response as PWResponse } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import { parseMtop } from '../session/mtop.js';
import { sleep } from '../session/wait.js';
import { debugTmpPath } from '../util/temp.js';

export interface OrderLogisticsOpts {
  orderId: string;
  maxScanPages?: string;
  status?: string;
  profile?: string;
  headed?: boolean;
}

export interface OrderLogisticsArgs {
  orderId: string;
  maxScanPages: number;
  /** Narrow the scan to one tradeStatus (e.g. "waitbuyerreceive") when known —
   *  much faster than scanning the full "all" list for heavy accounts. */
  statusHint?: string;
  headed?: boolean;
}

export interface LogisticsTrace {
  currentStatus: string;
  mailNo: string;
  carrier: string | null;
  logisticsId: string;
  remark: string;
}

export interface OrderLogisticsResult {
  orderId: string;
  found: boolean;
  trace: LogisticsTrace[];
}

const ORDER_LIST_URL =
  'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html';

const TRACE_API_RE = /mtoplgttraceservice\.querytrace/i;
const ORDER_LIST_API_RE = /mtop\.1688\.trading\.dataline\.service/i;
const SCAN_PAGE_SIZE = 50;

export async function execute(
  ctx: BrowserContext,
  args: OrderLogisticsArgs,
): Promise<OrderLogisticsResult> {
  if (!/^\d+$/.test(args.orderId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid orderId: ${args.orderId}`);
  }

  return withRecovery(
    ctx,
    { cmd: 'order-logistics', args },
    () => executeRaw(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

export async function executeRaw(
  ctx: BrowserContext,
  args: OrderLogisticsArgs,
): Promise<OrderLogisticsResult> {
  const status = args.statusHint ?? 'all';
  for (let p = 1; p <= args.maxScanPages; p++) {
    info(`Scanning page ${p} (tradeStatus=${status})...`);
    const { traceList, totalPages, orderIdsOnPage } = await fetchPageLogistics(
      ctx,
      p,
      SCAN_PAGE_SIZE,
      status,
    );
    if (traceList) {
      const match = traceList.find((t) => t.orderId === args.orderId);
      if (match) {
        return {
          orderId: args.orderId,
          found: true,
          trace: (match.trace ?? []).map(parseTrace),
        };
      }
    }
    if (orderIdsOnPage.includes(args.orderId)) {
      // Order is on this page but has no shipped logistics yet
      return { orderId: args.orderId, found: false, trace: [] };
    }
    if (p >= totalPages) break;
  }
  throw new CliError(
    12,
    'ORDER_NOT_FOUND',
    `Order ${args.orderId} not found in the most recent ${
      args.maxScanPages * SCAN_PAGE_SIZE
    } orders. Use --max-scan-pages to search deeper.`,
  );
}

interface RawTraceEntry {
  orderId?: string;
  trace?: {
    currentStatus?: string;
    mailNo?: string;
    logisticsId?: string;
    remark?: string;
  }[];
}

async function fetchPageLogistics(
  ctx: BrowserContext,
  page: number,
  pageSize: number,
  status: string,
): Promise<{
  traceList: RawTraceEntry[] | null;
  totalPages: number;
  orderIdsOnPage: string[];
}> {
  const pwPage = await ctx.newPage();
  let traceList: RawTraceEntry[] | null = null;
  let traceResponseCount = 0;
  let totalPages = Infinity;
  let orderIdsOnPage: string[] = [];

  const onResp = async (resp: PWResponse) => {
    const url = resp.url();
    try {
      const text = await resp.text();
      if (TRACE_API_RE.test(url)) {
        const j = parseMtop(text) as { data?: { result?: RawTraceEntry[] } };
        if (Array.isArray(j?.data?.result)) {
          if (process.env.BB1688_PROBE === '1' && traceResponseCount === 0) {
            try {
              const fs = await import('node:fs/promises');
              const file = debugTmpPath('1688-logistics-raw.json');
              await fs.writeFile(file, text);
              process.stderr.write(
                `[probe] saved raw logistics response → ${file}\n`,
              );
            } catch {
              /* ignore */
            }
          }
          // Accumulate: 1688 may issue multiple querytrace calls per page
          // (lazy-load / batch). Overwriting drops earlier batches.
          if (traceList === null) traceList = [];
          traceList.push(...j.data.result);
          traceResponseCount++;
        }
      } else if (ORDER_LIST_API_RE.test(url)) {
        const j = parseMtop(text) as {
          data?: { data?: { result?: string } };
        };
        const r = j?.data?.data?.result;
        if (typeof r === 'string') {
          const inner = JSON.parse(r) as {
            data?: { data?: { idStr?: string; id?: unknown }[]; pages?: number };
          };
          const list = inner?.data?.data;
          if (Array.isArray(list) && list[0]?.id !== undefined) {
            totalPages = inner.data?.pages ?? Infinity;
            orderIdsOnPage = list
              .map((o) => o.idStr ?? (o.id !== undefined ? String(o.id) : ''))
              .filter(Boolean);
          }
        }
      }
    } catch {
      /* ignore parse errors */
    }
  };
  pwPage.on('response', onResp);

  try {
    const url = `${ORDER_LIST_URL}?tradeStatus=${encodeURIComponent(status)}&page=${page}&pageSize=${pageSize}`;
    await pwPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for order list + trace responses. Multiple trace responses can
    // arrive in waves; keep listening for a quiet period after the last one
    // instead of breaking on the first.
    const deadline = Date.now() + 25000;
    let lastTraceCount = 0;
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (orderIdsOnPage.length === 0) {
        await sleep(250);
        continue;
      }
      if (traceResponseCount !== lastTraceCount) {
        lastTraceCount = traceResponseCount;
        stableSince = Date.now();
      }
      // If we've received at least one trace response AND nothing new for 1.5s,
      // consider trace data complete.
      if (
        traceResponseCount > 0 &&
        stableSince > 0 &&
        Date.now() - stableSince > 1500
      ) {
        break;
      }
      await sleep(250);
    }
  } finally {
    pwPage.off('response', onResp);
    await pwPage.close().catch(() => {});
  }

  return { traceList, totalPages, orderIdsOnPage };
}

function parseTrace(t: {
  currentStatus?: string;
  mailNo?: string;
  logisticsId?: string;
  remark?: string;
}): LogisticsTrace {
  const remark = t.remark ?? '';
  // Carrier is usually in "remark" after a "|" separator: "... | 中通快递(ZTO)承运"
  const carrierMatch = remark.match(/\|\s*([^|]+?)承运/);
  return {
    currentStatus: t.currentStatus ?? '',
    mailNo: t.mailNo ?? '',
    carrier: carrierMatch ? carrierMatch[1]!.trim() : null,
    logisticsId: t.logisticsId ?? '',
    remark,
  };
}

export async function run(opts: OrderLogisticsOpts): Promise<void> {
  const maxScanPages = Math.max(
    1,
    parseInt(opts.maxScanPages ?? '5', 10),
  );
  const data = await dispatch<OrderLogisticsArgs, OrderLogisticsResult>(
    'order-logistics',
    { orderId: opts.orderId, maxScanPages, statusHint: opts.status, headed: opts.headed },
    { headed: opts.headed, profile: opts.profile },
  );
  emit({
    human: () => printLogistics(data),
    data,
  });
}

function printLogistics(r: OrderLogisticsResult): void {
  if (!r.found) {
    process.stdout.write(`Order ${r.orderId}: not shipped yet (no logistics).\n`);
    return;
  }
  process.stdout.write(`Order ${r.orderId}\n`);
  r.trace.forEach((t, i) => {
    if (r.trace.length > 1) process.stdout.write(`  package ${i + 1}:\n`);
    const prefix = r.trace.length > 1 ? '    ' : '  ';
    process.stdout.write(`${prefix}status:  ${t.currentStatus}\n`);
    process.stdout.write(`${prefix}mailNo:  ${t.mailNo}\n`);
    if (t.carrier) process.stdout.write(`${prefix}carrier: ${t.carrier}\n`);
    process.stdout.write(`${prefix}remark:  ${t.remark}\n`);
  });
}
