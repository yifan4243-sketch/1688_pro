import React, { useEffect, useRef, useState, useMemo } from 'react';
import { getApi, CommandRecord } from '../../services/api';
import { shouldDefaultCard } from '../../services/offer-adapter';
import ProgressOfferCard, { toProgressCards, ProgressOfferCardItem } from './ProgressOfferCard';
import OfferDetailModal from './OfferDetailModal';
import ProgressSummary from './ProgressSummary';

interface Props {
  record: CommandRecord | null;
  resultType?: string;
  placeholderCards?: number;
  running?: boolean;
  activeProfile?: string;
  onDeepTasksChange?: (tasks: Array<{ key: string; offerId?: string; title?: string; image?: string; status: 'queued' | 'collecting' | 'success' | 'failed'; message?: string; createdAt: string; finishedAt?: string }>) => void;
}

type ViewMode = 'card' | 'json';

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function priceText(raw: Record<string, unknown>): string {
  const direct = text(raw.priceRange) || text(raw.priceText);
  if (direct) return direct;
  const price = objectOf(raw.price);
  if (price?.text) return text(price.text);
  const min = raw.priceMin ?? price?.min;
  const max = raw.priceMax ?? price?.max;
  if (min != null && max != null && Number(min) !== Number(max)) return `¥${min}-${max}`;
  if (min != null) return `¥${min}`;
  if (max != null) return `¥${max}`;
  return '';
}

function imageOf(raw: Record<string, unknown>): string {
  const direct = text(raw.image) || text(raw.mainImage) || text(raw.imageUrl) || text(raw.picUrl) || text(raw.thumb);
  if (direct) return direct;
  const images = raw.images || raw.gallery || raw.imageList;
  if (Array.isArray(images)) {
    const first = images[0];
    if (typeof first === 'string') return first;
    const obj = objectOf(first);
    return text(obj?.url) || text(obj?.src) || text(obj?.image);
  }
  return '';
}

function offerIdOf(raw: Record<string, unknown>): string {
  return text(raw.offerId) || text(raw.offer_id) || text(raw.id);
}

function cardFromRaw(raw: Record<string, unknown>, index: number, status: ProgressOfferCardItem['status'] = 'basic-ready'): ProgressOfferCardItem {
  const offerId = offerIdOf(raw);
  return {
    slotIndex: index,
    offerId,
    title: text(raw.title) || text(raw.subject) || text(raw.name) || text(raw.productTitle) || (offerId ? `商品 ${offerId}` : ''),
    price: priceText(raw),
    image: imageOf(raw),
    status,
    raw,
  };
}

function normalizeCards(data: Record<string, unknown> | undefined, placeholderCards?: number, running?: boolean): ProgressOfferCardItem[] {
  if (!data) {
    if (placeholderCards && placeholderCards > 0) {
      return Array.from({ length: placeholderCards }, (_, i) => ({
        slotIndex: i,
        status: i === 0 && running ? 'collecting' as const : 'waiting' as const,
      }));
    }
    return [];
  }

  const rootOffers = Array.isArray(data.offers) ? data.offers.map(objectOf).filter(Boolean) as Record<string, unknown>[] : [];
  if (rootOffers.length > 0) {
    const deeppro = objectOf(data.deeppro);
    const deepOffers = Array.isArray(deeppro?.offers) ? deeppro.offers as Array<Record<string, unknown>> : [];
    const deepFailures = Array.isArray(deeppro?.failures) ? deeppro.failures as Array<Record<string, unknown>> : [];
    const deepMap = new Map<string, unknown>();
    for (const d of deepOffers) deepMap.set(offerIdOf(d), d);
    return toProgressCards(
      Math.max(rootOffers.length, placeholderCards || 0, deepOffers.length + deepFailures.length),
      rootOffers,
      deepMap,
      deepFailures,
      { isDeepPro: Boolean(deeppro?.enabled) },
    );
  }

  const items = Array.isArray(data.items) ? data.items.map(objectOf).filter(Boolean) as Record<string, unknown>[] : [];
  if (items.length > 0) {
    return items.map((item, index) => {
      const offer = objectOf(item.offer);
      const summary = objectOf(item.summary);
      if (offer) return cardFromRaw(offer, index);
      if (summary) return cardFromRaw(summary, index, item.ok === false ? 'deep-failed' : 'deep-success');
      return cardFromRaw(item, index);
    });
  }

  if (offerIdOf(data) || text(data.title) || text(data.mainImage) || Array.isArray(data.skus)) {
    return [cardFromRaw(data, 0, Array.isArray(data.skus) ? 'deep-success' : 'basic-ready')];
  }

  return [];
}

function cardKey(card: ProgressOfferCardItem): string {
  return card.offerId ? `offer:${card.offerId}` : `slot:${card.slotIndex}`;
}

export default function ResultRenderer({ record, resultType, placeholderCards, running, activeProfile, onDeepTasksChange }: Props) {
  const api = getApi();
  const [viewMode, setViewMode] = useState<ViewMode>(
    shouldDefaultCard(resultType) ? 'card' : 'json',
  );
  const [toast, setToast] = useState('');
  const [detailItem, setDetailItem] = useState<ProgressOfferCardItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [cardOverrides, setCardOverrides] = useState<Record<string, Partial<ProgressOfferCardItem>>>({});
  const [deepJsonByOfferId, setDeepJsonByOfferId] = useState<Record<string, Record<string, unknown>>>({});
  const [deepFailuresByOfferId, setDeepFailuresByOfferId] = useState<Record<string, Record<string, unknown>>>({});

  const baseData = record?.stdoutJson as Record<string, unknown> | undefined;

  const data = useMemo(() => {
    if (!baseData) return undefined;
    const baseOffers = (Array.isArray(baseData.offers) ? baseData.offers : []) as Array<Record<string, unknown>>;
    const offers = baseOffers.map((o) => {
      if (!o || typeof o !== 'object') return o;
      const offerId = String(o.offerId || o.offer_id || o.id || '');
      const deep = deepJsonByOfferId[offerId];
      const failure = deepFailuresByOfferId[offerId];
      if (deep) {
        const imgs = Array.isArray(deep.images) ? deep.images as string[] : [];
        return { ...o, title: deep.title || o.title, image: deep.mainImage || imgs[0] || o.image, priceRange: deep.priceRange || o.priceRange, deepCollected: true, deepCollectStatus: 'success', deepOffer: deep, deepCollectMeta: deep._deepCollectMeta };
      }
      if (failure) return { ...o, deepCollected: false, deepCollectStatus: 'failed', deepCollectFailure: failure };
      return o;
    });
    const deepOffers = Object.values(deepJsonByOfferId);
    const failures = Object.values(deepFailuresByOfferId);
    const hasManualDeep = deepOffers.length > 0 || failures.length > 0;
    if (!hasManualDeep) return { ...baseData, offers };
    return { ...baseData, offers, deeppro: { ...(baseData.deeppro && typeof baseData.deeppro === 'object' ? baseData.deeppro as Record<string, unknown> : {}), enabled: true, mode: 'manual-per-card', success: deepOffers.length, failed: failures.length, offers: deepOffers, failures } };
  }, [baseData, deepJsonByOfferId, deepFailuresByOfferId]);

  // Build progress cards from result data, applying per-card overrides
  const progressCards = useMemo<ProgressOfferCardItem[]>(() => {
    const baseCards = normalizeCards(data, placeholderCards, running);
    return baseCards.map((card) => {
      const key = card.offerId ? `offer:${card.offerId}` : `slot:${card.slotIndex}`;
      const override = cardOverrides[key];
      return override ? { ...card, ...override } : card;
    });
  }, [data, placeholderCards, running, cardOverrides]);

  const visibleCards = useMemo(() => progressCards, [progressCards]);
  const selectableCards = visibleCards.filter((card) => card.status !== 'waiting' || card.offerId || card.raw || card.title || card.image);
  const hasOffers = visibleCards.length > 0;
  const selectedCount = selectableCards.filter((card) => selectedKeys.has(cardKey(card))).length;
  const allSelected = selectableCards.length > 0 && selectedCount === selectableCards.length;

  const toggleSelect = (item: ProgressOfferCardItem) => {
    const key = cardKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      selectableCards.forEach((card) => next.add(cardKey(card)));
      return next;
    });
  };

  const clearSelected = () => {
    setSelectedKeys(new Set());
  };

  // ----- per-card deep collect queue with profile fallback + task map + JSON merge -----
  const deepQueueRef = useRef<Array<{ key: string; item: ProgressOfferCardItem }>>([]);
  const deepRunningRef = useRef(false);
  const deepTaskMapRef = useRef<Record<string, { key: string; offerId?: string; title?: string; image?: string; status: 'queued' | 'collecting' | 'success' | 'failed'; message?: string; profile?: string; attempt?: number; createdAt: string; updatedAt?: string; finishedAt?: string }>>({});
  const MAX_ATTEMPTS_PER_PROFILE = 2;

  const publishDeepTasks = () => {
    const tasks = Object.values(deepTaskMapRef.current).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    onDeepTasksChange?.(tasks);
  };

  const upsertDeepTask = (key: string, patch: Partial<typeof deepTaskMapRef.current[string]>) => {
    const prev = deepTaskMapRef.current[key];
    deepTaskMapRef.current[key] = {
      key, offerId: patch.offerId ?? prev?.offerId, title: patch.title ?? prev?.title,
      image: patch.image ?? prev?.image, status: patch.status ?? prev?.status ?? 'queued',
      message: patch.message ?? prev?.message, profile: patch.profile ?? prev?.profile,
      attempt: patch.attempt ?? prev?.attempt, createdAt: prev?.createdAt || patch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(), finishedAt: patch.finishedAt ?? prev?.finishedAt,
    };
    publishDeepTasks();
  };

  const upsertDeepJson = (offerId: string | undefined, deep: Record<string, unknown>, meta: Record<string, unknown>) => {
    if (!offerId) return;
    setDeepJsonByOfferId((prev) => ({ ...prev, [offerId]: { ...deep, _deepCollectMeta: { ...meta, collectedAt: new Date().toISOString() } } }));
  };
  const upsertDeepFailure = (offerId: string | undefined, failure: Record<string, unknown>) => {
    if (!offerId) return;
    setDeepFailuresByOfferId((prev) => ({ ...prev, [offerId]: failure }));
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const showToast = (msg: string, timeout = 1800) => {
    setToast(msg); setTimeout(() => setToast(''), timeout);
  };

  const getDeepCollectProfilePool = async (): Promise<string[]> => {
    try {
      const acc = await api.accounts.list();
      const profiles = (acc?.accounts || []).map((a) => String(a.profile || '').trim()).filter(Boolean);
      return Array.from(new Set(['default', ...profiles])).filter(Boolean);
    } catch { return ['default']; }
  };

  type DeepQueueEntry = { key: string; item: ProgressOfferCardItem };

  type OfferBatchJson = {
    mode?: string;
    total?: number;
    success?: number;
    failed?: number;
    offerIds?: string[];
    offers?: Array<Record<string, unknown>>;
    failures?: Array<Record<string, unknown>>;
  };

  function offerIdFromDeep(raw: Record<string, unknown>): string {
    return String(raw.offerId || raw.offer_id || raw.id || '');
  }

  function normalizeOfferBatchJson(value: unknown): OfferBatchJson {
    if (!value || typeof value !== 'object') return {};
    const data = value as Record<string, unknown>;
    if (Array.isArray(data.offers) || Array.isArray(data.failures)) {
      return data as OfferBatchJson;
    }
    const oid = offerIdFromDeep(data);
    if (oid) {
      return { mode: 'single', total: 1, success: 1, failed: 0, offerIds: [oid], offers: [data], failures: [] };
    }
    return {};
  }

  function isRiskOrCaptchaFailure(result: { status?: string; error?: string }): boolean {
    const text = `${result.status || ''} ${result.error || ''}`;
    return /CAPTCHA|RISK|risk_control|验证码|滑块|风控/i.test(text);
  }

  function isFailureRiskOrCaptcha(failure: Record<string, unknown>): boolean {
    const text = `${failure.code || ''} ${failure.message || ''}`;
    return /CAPTCHA|RISK|risk_control|验证码|滑块|风控|登录|NOT_LOGGED_IN/i.test(text);
  }

  const runOfferProBatchOnce = async (
    entries: DeepQueueEntry[],
    profile: string,
    attempt: number,
  ): Promise<{
    okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }>;
    failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }>;
  }> => {
    const ids = entries.map((entry) => entry.item.offerId).filter(Boolean) as string[];

    const entryByOfferId = new Map<string, DeepQueueEntry>();
    for (const entry of entries) {
      if (entry.item.offerId) entryByOfferId.set(String(entry.item.offerId), entry);
    }

    for (const entry of entries) {
      setCardOverrides((prev) => ({
        ...prev,
        [entry.key]: { status: 'deep-collecting', message: `正在使用 ${profile} 深度采集，第 ${attempt}/${MAX_ATTEMPTS_PER_PROFILE} 次`, code: '' },
      }));
      upsertDeepTask(entry.key, {
        status: 'collecting',
        profile,
        attempt,
        message: `正在使用 ${profile} 深度采集，第 ${attempt}/${MAX_ATTEMPTS_PER_PROFILE} 次`,
      });
    }

    const rec = await api.commands.run({
      commandId: 'offer',
      args: { offerIds: ids.join('\n') },
      options: { pro: true, headed: true },
      profile,
      confirmed: true,
    });

    const data = normalizeOfferBatchJson(rec.stdoutJson);
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const failures = Array.isArray(data.failures) ? data.failures : [];

    const okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }> = [];
    const failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }> = [];
    const successIds = new Set<string>();

    for (const deep of offers) {
      const offerId = offerIdFromDeep(deep);
      if (!offerId) continue;
      const entry = entryByOfferId.get(offerId);
      if (!entry) continue;
      successIds.add(offerId);
      okEntries.push({ entry, data: deep });
    }

    for (const failure of failures) {
      const offerId = String(failure.offerId || failure.offer_id || failure.id || '');
      const entry = entryByOfferId.get(offerId);
      if (entry) failedEntries.push({ entry, failure });
    }

    for (const entry of entries) {
      const offerId = String(entry.item.offerId || '');
      const alreadySuccess = successIds.has(offerId);
      const alreadyFailed = failedEntries.some((x) => x.entry.key === entry.key);
      if (!alreadySuccess && !alreadyFailed) {
        failedEntries.push({
          entry,
          failure: {
            offerId,
            code: rec.status === 'success' ? 'MISSING_BATCH_RESULT' : rec.status || 'BATCH_FAILED',
            message: rec.error?.message || rec.stderrText || '批量深采未返回该商品结果',
          },
        });
      }
    }

    return { okEntries, failedEntries };
  };

  const applyDeepSuccess = (
    entry: DeepQueueEntry,
    deep: Record<string, unknown>,
    profile: string,
    attempt: number,
  ) => {
    const { key, item } = entry;
    const imgs = Array.isArray(deep.images) ? deep.images as string[] : [];
    const title = String(deep.title || item.title || '');
    const image = String(deep.mainImage || imgs[0] || item.image || '');
    const price = String(deep.priceRange || deep.priceText || item.price || '');

    setCardOverrides((prev) => ({
      ...prev,
      [key]: { title, price, image, status: 'deep-success', raw: deep, message: `${profile} 第 ${attempt} 次成功`, code: '' },
    }));

    upsertDeepTask(key, {
      title, image, status: 'success', profile, attempt,
      message: `${profile} 第 ${attempt} 次成功`,
      finishedAt: new Date().toISOString(),
    });
    upsertDeepJson(item.offerId, deep, { status: 'success', profile, attempt });
  };

  const applyDeepFailed = (
    entry: DeepQueueEntry,
    failure: Record<string, unknown>,
    profile: string,
    attempt: number,
  ) => {
    const { key, item } = entry;
    const message = String(failure.message || failure.error || failure.code || '深度采集失败');
    const code = String(failure.code || 'DEEP_COLLECT_FAILED');

    setCardOverrides((prev) => ({
      ...prev,
      [key]: { status: 'deep-failed', message, code },
    }));

    upsertDeepTask(key, {
      status: 'failed', profile, attempt, message,
      finishedAt: new Date().toISOString(),
    });
    upsertDeepFailure(item.offerId, {
      offerId: item.offerId, code, message,
      failedAt: new Date().toISOString(),
      attempts: [{ profile, attempt, code, message }],
    });
  };

  const runDeepCollectBatchWithFallback = async (entries: DeepQueueEntry[]) => {
    if (entries.length === 0) return;

    const profiles = await getDeepCollectProfilePool();
    let remaining = entries;

    for (let pi = 0; pi < profiles.length && remaining.length > 0; pi++) {
      const profile = profiles[pi]!;

      // First attempt: open one headed browser, collect all remaining entries.
      let firstResult: {
        okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }>;
        failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }>;
      };

      try {
        firstResult = await runOfferProBatchOnce(remaining, profile, 1);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e || '批量深采失败');
        firstResult = {
          okEntries: [],
          failedEntries: remaining.map((entry) => ({
            entry,
            failure: { offerId: entry.item.offerId, code: 'BATCH_EXCEPTION', message },
          })),
        };
      }

      for (const item of firstResult.okEntries) {
        applyDeepSuccess(item.entry, item.data, profile, 1);
      }

      const firstFailed = firstResult.failedEntries;
      if (firstFailed.length === 0) {
        remaining = [];
        break;
      }

      // Second attempt: open a fresh browser for items that failed the first time.
      for (const item of firstFailed) {
        upsertDeepTask(item.entry.key, {
          status: 'collecting', profile, attempt: 2,
          message: `${profile} 第一次失败，重新打开浏览器进行第二次测试`,
        });
        setCardOverrides((prev) => ({
          ...prev,
          [item.entry.key]: {
            status: 'deep-collecting',
            message: `${profile} 第一次失败，重新打开浏览器进行第二次测试`,
            code: String(item.failure.code || ''),
          },
        }));
      }

      let secondResult: {
        okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }>;
        failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }>;
      };

      try {
        secondResult = await runOfferProBatchOnce(firstFailed.map((x) => x.entry), profile, 2);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e || '批量深采二次测试失败');
        secondResult = {
          okEntries: [],
          failedEntries: firstFailed.map((x) => ({
            entry: x.entry,
            failure: { offerId: x.entry.item.offerId, code: 'BATCH_RETRY_EXCEPTION', message },
          })),
        };
      }

      for (const item of secondResult.okEntries) {
        applyDeepSuccess(item.entry, item.data, profile, 2);
      }

      const stillFailed = secondResult.failedEntries;

      if (stillFailed.length === 0) {
        remaining = [];
        break;
      }

      // Second attempt still failed: try next profile if available.
      const nextProfile = profiles[pi + 1];

      if (nextProfile) {
        for (const item of stillFailed) {
          const msg = `${profile} 二次测试失败，切换到 ${nextProfile}`;
          setCardOverrides((prev) => ({
            ...prev,
            [item.entry.key]: {
              status: 'deep-collecting',
              message: msg,
              code: String(item.failure.code || 'SWITCH_PROFILE'),
            },
          }));
          upsertDeepTask(item.entry.key, {
            status: 'collecting', profile, attempt: 2, message: msg,
          });
        }
        remaining = stillFailed.map((x) => x.entry);
        await sleep(800);
        continue;
      }

      // No more profiles — mark as permanently failed.
      for (const item of stillFailed) {
        applyDeepFailed(item.entry, item.failure, profile, 2);
      }
      remaining = [];
    }
  };

  const processDeepQueue = async () => {
    if (deepRunningRef.current) return;
    const batch = deepQueueRef.current.slice();
    if (batch.length === 0) return;

    const processingKeys = new Set(batch.map((entry) => entry.key));
    deepRunningRef.current = true;

    for (const entry of batch) {
      upsertDeepTask(entry.key, { status: 'collecting', message: '等待批量深度采集启动' });
    }

    try {
      await runDeepCollectBatchWithFallback(batch);
    } finally {
      deepQueueRef.current = deepQueueRef.current.filter((entry) => !processingKeys.has(entry.key));
      deepRunningRef.current = false;
      setTimeout(() => processDeepQueue(), 500);
    }
  };

  const enqueueSingleDeepCollect = (item: ProgressOfferCardItem) => {
    if (!item.offerId) { showToast('缺少 Offer ID'); return; }
    const key = item.offerId ? `offer:${item.offerId}` : `slot:${item.slotIndex}`;
    const curStatus = cardOverrides[key]?.status || item.status;
    if (curStatus === 'deep-queued' || curStatus === 'deep-collecting') return;
    if (deepQueueRef.current.some((q) => q.key === key)) return;
    deepQueueRef.current = [...deepQueueRef.current, { key, item }];
    setCardOverrides((prev) => ({ ...prev, [key]: { status: 'deep-queued', message: '排队等待深度采集', code: '' } }));
    upsertDeepTask(key, { offerId: item.offerId, title: item.title, image: item.image, status: 'queued', message: '排队等待深度采集', createdAt: new Date().toISOString() });
    processDeepQueue();
  };

  useEffect(() => {
    setSelectedKeys(new Set());
    setCardOverrides({});
    setDeepJsonByOfferId({});
    setDeepFailuresByOfferId({});
    deepQueueRef.current = [];
    deepRunningRef.current = false;
    deepTaskMapRef.current = {};
    onDeepTasksChange?.([]);
  }, [record?.runId, resultType, onDeepTasksChange]);

  const deeppro = data?.deeppro as Record<string, unknown> | undefined;
  const deepproFailures = (deeppro?.failures as Array<Record<string, unknown>>) || [];

  const copyFullJson = async () => {
    const text = JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setToast('已复制完整 JSON');
      setTimeout(() => setToast(''), 1600);
    } catch { setToast('复制失败'); }
  };

  const failureMessageZh = (f: Record<string, unknown>): string => {
    const msg = String(f.message ?? '').trim();
    if (msg) return msg;
    const code = String(f.code ?? '');
    const map: Record<string, string> = {
      CAPTCHA_INTERCEPTION: '验证码或滑块拦截',
      MISSING_PRICE: '商品价格缺失',
      MISSING_IMAGES: '商品图片缺失',
      MISSING_TITLE: '商品标题缺失',
      RISK_OR_CAPTCHA_TITLE: '页面被风控或验证码拦截',
      EMPTY_OFFER_RESULT: '采集结果为空',
    };
    return map[code] || '采集失败，原因未识别。';
  };

  return (
    <div className="result-renderer">
      <div className="result-unified-toolbar">
          <div className="result-left-tools">
            {hasOffers && (
              <>
                <button type="button" className="selection-action-btn" onClick={toggleSelectAll} disabled={selectableCards.length === 0}>
                  {allSelected ? '取消全选' : '全选'}
                </button>
                <button type="button" className="selection-action-btn" onClick={clearSelected} disabled={selectedCount === 0}>
                  取消勾选{selectedCount > 0 ? ` ${selectedCount}` : ''}
                </button>
                <ProgressSummary cards={visibleCards} running={!!running} compact />
              </>
            )}
          </div>
          <div className="result-top-actions">
            <div className="mode-toggle">
              {hasOffers && (
                <button className={`mode-btn ${viewMode === 'card' ? 'active' : ''}`} onClick={() => setViewMode('card')}>卡片模式</button>
              )}
              <button className={`mode-btn ${viewMode === 'json' ? 'active' : ''}`} onClick={() => setViewMode('json')}>JSON 模式</button>
            </div>
            {data && (
              <button className="glass-toolbar-button" onClick={copyFullJson}>
                <span className="toolbar-btn-icon">⧉</span>
                <span>复制完整 JSON</span>
              </button>
            )}
          </div>
        </div>

      {/* Progress card grid */}
      {viewMode === 'card' && hasOffers && (
        <div className="progress-card-grid">
          {visibleCards.map((card) => (
            <ProgressOfferCard
              key={cardKey(card)}
              item={card}
              selected={selectedKeys.has(cardKey(card))}
              onSelectToggle={toggleSelect}
              onDeepCollect={enqueueSingleDeepCollect}
              onOzonPlaceholder={() => {
                setToast('上架至 OZON 暂未接入');
                setTimeout(() => setToast(''), 1600);
              }}
              onOpen={(item) => {
                if (item.offerId || item.raw || item.title || item.image) {
                  setDetailItem(item);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* JSON view */}
      {viewMode === 'json' && data && (
        <div className="result-preview">
          <pre className="json-output">{data ? JSON.stringify(data, null, 2) : '等待数据...'}</pre>
        </div>
      )}

      {/* DEEPPRO failures summary */}
      {deepproFailures.length > 0 && (
        <div className="result-preview error-detail" style={{ marginTop: 12 }}>
          <h4>DEEPPRO 失败详情</h4>
          {deepproFailures.map((f, i) => (
            <div key={i} className="error-grid" style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <div><span>Offer ID</span><strong>{String(f.offerId ?? '-')}</strong></div>
              <div><span>信息</span><strong>{failureMessageZh(f)}</strong></div>
              <div><span>尝试次数</span><strong>{String(f.attempts ?? '-')}</strong></div>
              {Array.isArray(f.flags) && <div><span>Flags</span><strong>{f.flags.map(String).join(', ')}</strong></div>}
            </div>
          ))}
        </div>
      )}

      {/* DEEPPRO progress log (collapsible) */}
      {record?.stderrText && /DEEPPRO/i.test(record.stderrText) && (
        <details className="advanced-section" style={{ marginTop: 12 }}>
          <summary className="advanced-toggle">DEEPPRO 进度日志</summary>
          <div className="error-stderr" style={{ marginTop: 8 }}>
            <pre>{record.stderrText}</pre>
          </div>
        </details>
      )}

      {/* Error detail */}
      {record && record.status !== 'success' && record.status !== 'running' && (
        <div className="result-preview error-detail">
          <h4>错误详情</h4>
          <div className="error-grid">
            <div><span>状态</span><strong>{record.status}</strong></div>
            <div><span>退出码</span><strong>{record.exitCode ?? '-'}</strong></div>
            <div><span>错误信息</span><strong>{record.error?.message || record.stderrText || '-'}</strong></div>
          </div>
          {record.argv?.length > 0 && (
            <div className="error-argv"><span>CLI 命令</span><code>{record.argv.join(' ')}</code></div>
          )}
          {record.stderrText && (
            <div className="error-stderr"><span>stderr</span><pre>{record.stderrText}</pre></div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {detailItem && (
        <OfferDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
