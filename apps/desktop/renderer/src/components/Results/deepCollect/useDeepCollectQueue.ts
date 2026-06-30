import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { getApi } from '../../../services/api';
import type { ProgressOfferCardItem } from '../ProgressOfferCard';
import { deepCollectLog } from './debug';
import { formatCommandError } from '../errorFormatter';
import type {
  DeepCollectDataPatch,
  DeepCollectTask,
  DeepCollectTaskPatch,
  DeepQueueEntry,
  DeepTasksChangeHandler,
  OfferBatchJson,
} from './types';

type DesktopApi = ReturnType<typeof getApi>;

type UseDeepCollectQueueArgs = {
  api: DesktopApi;
  activeProfile?: string;
  manualDeepCollectHeaded?: boolean;
  captchaRetryHeaded?: boolean;
  onDeepTasksChange?: DeepTasksChangeHandler;
  onDeepCollectDataPatch?: (patch: DeepCollectDataPatch) => void;

  cardOverrides: Record<string, Partial<ProgressOfferCardItem>>;
  setCardOverrides: Dispatch<SetStateAction<Record<string, Partial<ProgressOfferCardItem>>>>;

  setDeepJsonByOfferId: Dispatch<SetStateAction<Record<string, Record<string, unknown>>>>;
  setDeepFailuresByOfferId: Dispatch<SetStateAction<Record<string, Record<string, unknown>>>>;

  showToast: (message: string, timeout?: number) => void;
};

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function offerIdFromDeep(raw: Record<string, unknown>): string {
  return String(raw.offerId || raw.offer_id || raw.id || '');
}

function normalizeOfferBatchJson(value: unknown): OfferBatchJson {
  if (!value || typeof value !== 'object') return {};

  const data = value as Record<string, unknown>;

  if (Array.isArray(data.offers) || Array.isArray(data.failures)) {
    return data as OfferBatchJson;
  }

  const offerId = offerIdFromDeep(data);

  if (offerId) {
    return {
      mode: 'single',
      total: 1,
      success: 1,
      failed: 0,
      offerIds: [offerId],
      offers: [data],
      failures: [],
    };
  }

  return {};
}

function classifyInvalidDeepOffer(deep: Record<string, unknown>): { code: string; message: string } | null {
  const title = String(deep.title || deep.subject || deep.name || '').trim();
  const code = String(deep.code || deep.errorCode || '').trim();
  const message = String(deep.message || deep.error || deep.errorMessage || '').trim();
  const url = String(deep.url || '').trim();

  const joined = `${title} ${code} ${message} ${url}`;

  if (/captcha interception/i.test(joined) || title === 'Captcha Interception') {
    return {
      code: 'CAPTCHA_INTERCEPTION',
      message: '页面被验证码拦截，深度采集未成功',
    };
  }

  if (/captcha|verify|verification|nocaptcha|x5sec|punish/i.test(joined)) {
    return {
      code: 'CAPTCHA_OR_VERIFY',
      message: '页面触发验证码或安全验证，深度采集未成功',
    };
  }

  if (/验证码|滑块|风控|安全验证|访问受限|验证失败|拦截/i.test(joined)) {
    return {
      code: 'RISK_OR_CAPTCHA',
      message: '页面被风控或验证码拦截，深度采集未成功',
    };
  }

  const images = Array.isArray(deep.images) ? deep.images : [];
  const mainImage = String(deep.mainImage || '').trim();
  const skus = Array.isArray(deep.skus) ? deep.skus : [];
  const options = Array.isArray(deep.options) ? deep.options : [];

  const hasUsefulTitle = Boolean(title) && !/^captcha/i.test(title);
  const hasUsefulImage = Boolean(mainImage) || images.length > 0;
  const hasUsefulDetail = skus.length > 0 || options.length > 0 || Boolean(deep.priceRange || deep.priceText);

  if (!hasUsefulTitle) {
    return {
      code: 'MISSING_TITLE',
      message: '深度采集结果缺少有效标题',
    };
  }

  if (!hasUsefulImage && !hasUsefulDetail) {
    return {
      code: 'INVALID_DEEP_OFFER',
      message: '深度采集结果不完整，未获得有效商品详情',
    };
  }

  return null;
}

function isCaptchaLikeFailure(failure: Record<string, unknown> | undefined): boolean {
  if (!failure) return false;

  const code = String(failure.code || failure.errorCode || '').trim();
  const message = String(failure.message || failure.error || failure.errorMessage || '').trim();
  const rawTitle = String(failure.rawTitle || '').trim();

  const joined = `${code} ${message} ${rawTitle}`;

  return /CAPTCHA|VERIFY|RISK|PUNISH|SLIDER|验证码|滑块|风控|安全验证|访问受限|拦截/i.test(joined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useDeepCollectQueue({
  api,
  activeProfile,
  manualDeepCollectHeaded = false,
  captchaRetryHeaded = false,
  onDeepTasksChange,
  onDeepCollectDataPatch,
  cardOverrides,
  setCardOverrides,
  setDeepJsonByOfferId,
  setDeepFailuresByOfferId,
  showToast,
}: UseDeepCollectQueueArgs) {
  const deepQueueRef = useRef<DeepQueueEntry[]>([]);
  const deepRunningRef = useRef(false);
  const deepQueueStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepTaskMapRef = useRef<Record<string, DeepCollectTask>>({});
  const runSessionIdRef = useRef<string>(`deep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const MAX_ATTEMPTS_PER_PROFILE = 2;

  function publishDeepTasks(): void {
    const tasks = Object.values(deepTaskMapRef.current)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    onDeepTasksChange?.(tasks);
  }

  function upsertDeepTask(key: string, patch: DeepCollectTaskPatch): void {
    const prev = deepTaskMapRef.current[key];

    deepTaskMapRef.current[key] = {
      key,
      sidebarKey: prev?.sidebarKey || `${runSessionIdRef.current}::${key}`,
      offerId: patch.offerId ?? prev?.offerId,
      title: patch.title ?? prev?.title,
      image: patch.image ?? prev?.image,
      status: patch.status ?? prev?.status ?? 'queued',
      message: patch.message ?? prev?.message,
      profile: patch.profile ?? prev?.profile,
      attempt: patch.attempt ?? prev?.attempt,
      createdAt: prev?.createdAt || patch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: patch.finishedAt ?? prev?.finishedAt,
    };

    publishDeepTasks();
  }

  function upsertDeepJson(
    offerId: string | undefined,
    deep: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): void {
    if (!offerId) return;

    const existingMeta = objectOf(deep._deepCollectMeta) || {};
    const collectedAt = String(existingMeta.collectedAt || meta.collectedAt || new Date().toISOString());

    setDeepJsonByOfferId((prev) => ({
      ...prev,
      [offerId]: {
        ...deep,
        _deepCollectMeta: {
          ...existingMeta,
          ...meta,
          collectedAt,
        },
      },
    }));

    setDeepFailuresByOfferId((prev) => {
      if (!prev[offerId]) return prev;
      const next = { ...prev };
      delete next[offerId];
      return next;
    });
  }

  function upsertDeepFailure(
    offerId: string | undefined,
    failure: Record<string, unknown>,
  ): void {
    if (!offerId) return;

    setDeepFailuresByOfferId((prev) => ({
      ...prev,
      [offerId]: failure,
    }));

    setDeepJsonByOfferId((prev) => {
      if (!prev[offerId]) return prev;
      const next = { ...prev };
      delete next[offerId];
      return next;
    });
  }

  async function getDeepCollectProfilePool(): Promise<string[]> {
    try {
      const accountResult = await api.accounts.list();
      const profiles = (accountResult?.accounts || [])
        .map((account) => String(account.profile || '').trim())
        .filter(Boolean);

      return Array.from(new Set([activeProfile || 'default', 'default', ...profiles]))
        .filter(Boolean);
    } catch {
      return [activeProfile || 'default'];
    }
  }

  async function runOfferProOnce(
    entry: DeepQueueEntry,
    profile: string,
    attempt: number,
    forcedHeaded = false,
  ): Promise<{
    okEntry?: { entry: DeepQueueEntry; data: Record<string, unknown> };
    failedEntry?: { entry: DeepQueueEntry; failure: Record<string, unknown> };
  }> {
    const offerId = String(entry.item.offerId || '');
    const effectiveHeaded = manualDeepCollectHeaded || forcedHeaded;
    const modeLabel = effectiveHeaded ? '可视化' : '无头';

    setCardOverrides((prev) => ({
      ...prev,
      [entry.key]: {
        status: 'deep-collecting',
        message: `正在使用 ${profile} ${modeLabel}深度采集，第 ${attempt}/${MAX_ATTEMPTS_PER_PROFILE} 次`,
        code: '',
      },
    }));

    upsertDeepTask(entry.key, {
      status: 'collecting',
      profile,
      attempt,
      message: `正在使用 ${profile} ${modeLabel}深度采集，第 ${attempt}/${MAX_ATTEMPTS_PER_PROFILE} 次`,
    });

    deepCollectLog('runOfferProOnce call CLI', {
      profile,
      attempt,
      headed: effectiveHeaded,
      mode: effectiveHeaded ? 'headed' : 'headless',
      offerId,
    });

    const record = await api.commands.run({
      commandId: 'offer',
      args: {
        offerIds: offerId,
      },
      options: {
        pro: true,
        headed: effectiveHeaded,
      },
      profile,
      confirmed: true,
    });

    deepCollectLog('runOfferProOnce CLI returned', {
      profile,
      attempt,
      status: record.status,
      argv: record.argv,
      stderr: record.stderrText,
    });

    const data = normalizeOfferBatchJson(record.stdoutJson);
    const offers = Array.isArray(data.offers) ? data.offers : [];
    const failures = Array.isArray(data.failures) ? data.failures : [];

    const deep = offers.find((item) => offerIdFromDeep(item) === offerId);

    if (deep) {
      const invalid = classifyInvalidDeepOffer(deep);

      if (invalid) {
        deepCollectLog('invalid deep offer detected', {
          offerId,
          code: invalid.code,
          message: invalid.message,
          title: deep.title,
        });

        return {
          failedEntry: {
            entry,
            failure: {
              offerId,
              code: invalid.code,
              message: invalid.message,
              rawTitle: deep.title,
            },
          },
        };
      }

      return {
        okEntry: {
          entry,
          data: deep,
        },
      };
    }

    const failure = failures.find((item) => String(item.offerId || item.offer_id || item.id || '') === offerId);

    if (failure) {
      return {
        failedEntry: {
          entry,
          failure,
        },
      };
    }

    const errorMessage =
      record.error && typeof record.error === 'object'
        ? String((record.error as { message?: unknown }).message || '')
        : '';

    return {
      failedEntry: {
        entry,
        failure: {
          offerId,
          code: record.status === 'success'
            ? 'MISSING_OFFER_RESULT'
            : record.status || 'OFFER_FAILED',
          message: errorMessage || record.stderrText || '深度采集未返回该商品结果',
        },
      },
    };
  }

  function applyDeepSuccess(
    entry: DeepQueueEntry,
    deep: Record<string, unknown>,
    profile: string,
    attempt: number,
  ): void {
    const { key, item } = entry;
    const images = Array.isArray(deep.images) ? deep.images as string[] : [];

    const title = String(deep.title || item.title || '');
    const image = String(deep.mainImage || images[0] || item.image || '');
    const price = String(deep.priceRange || deep.priceText || item.price || '');
    const collectedAt = new Date().toISOString();
    const deepWithMeta = {
      ...deep,
      _deepCollectMeta: {
        ...(objectOf(deep._deepCollectMeta) || {}),
        status: 'success',
        profile,
        attempt,
        collectedAt,
      },
    };

    setCardOverrides((prev) => ({
      ...prev,
      [key]: {
        title,
        price,
        image,
        status: 'deep-success',
        raw: deep,
        message: `${profile} 第 ${attempt} 次成功`,
        code: '',
      },
    }));

    upsertDeepTask(key, {
      title,
      image,
      status: 'success',
      profile,
      attempt,
      message: `${profile} 第 ${attempt} 次成功`,
      finishedAt: new Date().toISOString(),
    });

    upsertDeepJson(item.offerId, deepWithMeta, {
      status: 'success',
      profile,
      attempt,
      collectedAt,
    });

    if (item.offerId) {
      onDeepCollectDataPatch?.({
        offerId: item.offerId,
        deep: deepWithMeta,
      });
    }
  }

  function applyDeepFailed(
    entry: DeepQueueEntry,
    failure: Record<string, unknown>,
    profile: string,
    attempt: number,
  ): void {
    const { key, item } = entry;
    const message = String(failure.message || failure.error || failure.code || '深度采集失败');
    const code = String(failure.code || 'DEEP_COLLECT_FAILED');
    const failedAt = new Date().toISOString();
    const previousAttempts = Array.isArray(failure.attempts) ? failure.attempts : [];
    const failurePatch = {
      ...failure,
      offerId: item.offerId,
      code,
      message,
      failedAt,
      attempts: [
        ...previousAttempts,
        {
          profile,
          attempt,
          code,
          message,
        },
      ],
    };

    setCardOverrides((prev) => ({
      ...prev,
      [key]: {
        title: item.title,
        price: item.price,
        image: item.image,
        status: 'deep-failed',
        message,
        code,
      },
    }));

    upsertDeepTask(key, {
      status: 'failed',
      profile,
      attempt,
      message,
      finishedAt: new Date().toISOString(),
    });

    upsertDeepFailure(item.offerId, failurePatch);

    if (item.offerId) {
      onDeepCollectDataPatch?.({
        offerId: item.offerId,
        failure: failurePatch,
      });
    }
  }

  async function runDeepCollectEntryWithFallback(entry: DeepQueueEntry): Promise<void> {
    const profiles = await getDeepCollectProfilePool();

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
      const profile = profiles[profileIndex]!;

      let firstResult: Awaited<ReturnType<typeof runOfferProOnce>>;

      try {
        firstResult = await runOfferProOnce(entry, profile, 1);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error || '');
        const friendly = formatCommandError({ message: rawMessage, stderr: rawMessage, context: 'offer' });

        firstResult = {
          failedEntry: {
            entry,
            failure: {
              offerId: entry.item.offerId,
              code: 'OFFER_EXCEPTION',
              message: friendly.summary,
              rawTitle: rawMessage,
            },
          },
        };
      }

      if (firstResult.okEntry) {
        applyDeepSuccess(firstResult.okEntry.entry, firstResult.okEntry.data, profile, 1);
        return;
      }

      const firstFailure = firstResult.failedEntry;

      if (!firstFailure) {
        applyDeepFailed(
          entry,
          {
            offerId: entry.item.offerId,
            code: 'UNKNOWN_DEEP_FAILURE',
            message: '深度采集失败，原因未知',
          },
          profile,
          1,
        );
        return;
      }

      const secondAttemptHeaded = captchaRetryHeaded && isCaptchaLikeFailure(firstFailure.failure);

      const retryMessage = secondAttemptHeaded
        ? `${profile} 第一次疑似验证码/风控失败，第二次打开浏览器等待人工处理`
        : `${profile} 第一次失败，重新进行第二次测试`;

      upsertDeepTask(entry.key, {
        status: 'collecting',
        profile,
        attempt: 2,
        message: retryMessage,
      });

      setCardOverrides((prev) => ({
        ...prev,
        [entry.key]: {
          status: 'deep-collecting',
          message: retryMessage,
          code: String(firstFailure.failure.code || ''),
        },
      }));

      let secondResult: Awaited<ReturnType<typeof runOfferProOnce>>;

      try {
        secondResult = await runOfferProOnce(entry, profile, 2, secondAttemptHeaded);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error || '');
        const friendly = formatCommandError({ message: rawMessage, stderr: rawMessage, context: 'offer' });

        secondResult = {
          failedEntry: {
            entry,
            failure: {
              offerId: entry.item.offerId,
              code: 'OFFER_RETRY_EXCEPTION',
              message: friendly.summary,
              rawTitle: rawMessage,
            },
          },
        };
      }

      if (secondResult.okEntry) {
        applyDeepSuccess(secondResult.okEntry.entry, secondResult.okEntry.data, profile, 2);
        return;
      }

      const secondFailure = secondResult.failedEntry;
      const nextProfile = profiles[profileIndex + 1];

      if (nextProfile) {
        const switchMessage = `${profile} 第二次仍失败，切换账号 ${nextProfile} 继续采集`;

        setCardOverrides((prev) => ({
          ...prev,
          [entry.key]: {
            status: 'deep-collecting',
            message: switchMessage,
            code: String(secondFailure?.failure.code || 'SWITCH_PROFILE'),
          },
        }));

        upsertDeepTask(entry.key, {
          status: 'collecting',
          profile,
          attempt: 2,
          message: switchMessage,
        });

        await sleep(800);
        continue;
      }

      applyDeepFailed(
        entry,
        secondFailure?.failure || {
          offerId: entry.item.offerId,
          code: 'DEEP_COLLECT_FAILED',
          message: '所有账号尝试后仍然失败',
        },
        profile,
        2,
      );

      return;
    }

    applyDeepFailed(
      entry,
      {
        offerId: entry.item.offerId,
        code: 'NO_PROFILE_AVAILABLE',
        message: '没有可用账号进行深度采集',
      },
      activeProfile || 'default',
      1,
    );
  }

  async function processDeepQueue(): Promise<void> {
    if (deepRunningRef.current) return;

    if (deepQueueStartTimerRef.current) {
      clearTimeout(deepQueueStartTimerRef.current);
      deepQueueStartTimerRef.current = null;
    }

    if (deepQueueRef.current.length === 0) return;

    deepRunningRef.current = true;

    deepCollectLog('processDeepQueue start serial queue', {
      queueSize: deepQueueRef.current.length,
      offerIds: deepQueueRef.current.map((item) => item.item.offerId),
    });

    try {
      while (deepQueueRef.current.length > 0) {
        const entry = deepQueueRef.current.shift();

        if (!entry) break;

        deepCollectLog('processDeepQueue run next item', {
          offerId: entry.item.offerId,
          remaining: deepQueueRef.current.length,
        });

        upsertDeepTask(entry.key, {
          status: 'collecting',
          message: `等待深度采集启动，剩余 ${deepQueueRef.current.length} 个任务`,
        });

        await runDeepCollectEntryWithFallback(entry);

        if (deepQueueRef.current.length > 0) {
          await sleep(300);
        }
      }
    } finally {
      deepRunningRef.current = false;

      if (deepQueueRef.current.length > 0) {
        scheduleDeepQueueProcess(500);
      }
    }
  }

  function scheduleDeepQueueProcess(delayMs = 500): void {
    if (deepRunningRef.current) return;

    if (deepQueueStartTimerRef.current) {
      clearTimeout(deepQueueStartTimerRef.current);
    }

    deepQueueStartTimerRef.current = setTimeout(() => {
      deepQueueStartTimerRef.current = null;
      void processDeepQueue();
    }, delayMs);
  }

  function enqueueMultipleDeepCollect(items: ProgressOfferCardItem[]): void {
    const validItems = items.filter((item) => Boolean(item.offerId));

    deepCollectLog('batch button enqueue request', {
      selectedCount: items.length,
      validCount: validItems.length,
      offerIds: validItems.map((item) => item.offerId),
    });

    if (validItems.length === 0) {
      showToast('请选择有 Offer ID 的商品');
      return;
    }

    let added = 0;

    for (const item of validItems) {
      const key = item.offerId ? `offer:${item.offerId}` : `slot:${item.slotIndex}`;
      const currentStatus = cardOverrides[key]?.status || item.status;

      if (
        currentStatus === 'deep-queued' ||
        currentStatus === 'deep-collecting' ||
        currentStatus === 'collecting'
      ) {
        continue;
      }

      if (deepQueueRef.current.some((queueItem) => queueItem.key === key)) {
        continue;
      }

      deepQueueRef.current = [
        ...deepQueueRef.current,
        {
          key,
          item,
        },
      ];

      setCardOverrides((prev) => ({
        ...prev,
        [key]: {
          status: 'deep-queued',
          message: '排队等待深度采集',
          code: '',
        },
      }));

      upsertDeepTask(key, {
        offerId: item.offerId,
        title: item.title,
        image: item.image,
        status: 'queued',
        message: '排队等待深度采集',
        createdAt: new Date().toISOString(),
      });

      added += 1;
    }

    if (added === 0) {
      showToast('选中的商品已在深采队列中');
      return;
    }

    deepCollectLog('batch enqueue done', {
      added,
      queueSize: deepQueueRef.current.length,
      queueOfferIds: deepQueueRef.current.map((entry) => entry.item.offerId),
    });

    showToast(`已加入 ${added} 个商品到深采队列`, 1600);
    scheduleDeepQueueProcess(500);
  }

  function enqueueSingleDeepCollect(item: ProgressOfferCardItem): void {
    enqueueMultipleDeepCollect([item]);
  }

  function resetDeepCollectQueue(): void {
    if (deepQueueStartTimerRef.current) {
      clearTimeout(deepQueueStartTimerRef.current);
      deepQueueStartTimerRef.current = null;
    }

    deepQueueRef.current = [];
    deepRunningRef.current = false;
    deepTaskMapRef.current = {};
    runSessionIdRef.current = `deep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    enqueueSingleDeepCollect,
    enqueueMultipleDeepCollect,
    resetDeepCollectQueue,
  };
}
