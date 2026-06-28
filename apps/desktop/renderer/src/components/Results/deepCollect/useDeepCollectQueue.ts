import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { getApi } from '../../../services/api';
import type { ProgressOfferCardItem } from '../ProgressOfferCard';
import { deepCollectLog } from './debug';
import type {
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
  onDeepTasksChange?: DeepTasksChangeHandler;

  cardOverrides: Record<string, Partial<ProgressOfferCardItem>>;
  setCardOverrides: Dispatch<SetStateAction<Record<string, Partial<ProgressOfferCardItem>>>>;

  setDeepJsonByOfferId: Dispatch<SetStateAction<Record<string, Record<string, unknown>>>>;
  setDeepFailuresByOfferId: Dispatch<SetStateAction<Record<string, Record<string, unknown>>>>;

  showToast: (message: string, timeout?: number) => void;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useDeepCollectQueue({
  api,
  activeProfile,
  onDeepTasksChange,
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

    setDeepJsonByOfferId((prev) => ({
      ...prev,
      [offerId]: {
        ...deep,
        _deepCollectMeta: {
          ...meta,
          collectedAt: new Date().toISOString(),
        },
      },
    }));
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

  async function runOfferProBatchOnce(
    entries: DeepQueueEntry[],
    profile: string,
    attempt: number,
  ): Promise<{
    okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }>;
    failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }>;
  }> {
    const ids = entries
      .map((entry) => entry.item.offerId)
      .filter(Boolean) as string[];

    const entryByOfferId = new Map<string, DeepQueueEntry>();

    for (const entry of entries) {
      if (entry.item.offerId) {
        entryByOfferId.set(String(entry.item.offerId), entry);
      }
    }

    for (const entry of entries) {
      setCardOverrides((prev) => ({
        ...prev,
        [entry.key]: {
          status: 'deep-collecting',
          message: `正在使用 ${profile} 深度采集，第 ${attempt}/${MAX_ATTEMPTS_PER_PROFILE} 次`,
          code: '',
        },
      }));

      upsertDeepTask(entry.key, {
        status: 'collecting',
        profile,
        attempt,
        message: `正在使用 ${profile} 深度采集，第 ${attempt}/${MAX_ATTEMPTS_PER_PROFILE} 次`,
      });
    }

    deepCollectLog('runOfferProBatchOnce call CLI', {
      profile,
      attempt,
      count: ids.length,
      ids,
      offerIdsArg: ids.join('\\n'),
    });

    const record = await api.commands.run({
      commandId: 'offer',
      args: {
        offerIds: ids.join('\n'),
      },
      options: {
        pro: true,
        headed: true,
      },
      profile,
      confirmed: true,
    });

    deepCollectLog('runOfferProBatchOnce CLI returned', {
      profile,
      attempt,
      status: record.status,
      argv: record.argv,
      stdoutMode: (record as unknown as Record<string, unknown>).outputKind,
      stderr: record.stderrText,
    });

    const data = normalizeOfferBatchJson(record.stdoutJson);
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
      okEntries.push({
        entry,
        data: deep,
      });
    }

    for (const failure of failures) {
      const offerId = String(failure.offerId || failure.offer_id || failure.id || '');
      const entry = entryByOfferId.get(offerId);

      if (entry) {
        failedEntries.push({
          entry,
          failure,
        });
      }
    }

    for (const entry of entries) {
      const offerId = String(entry.item.offerId || '');
      const alreadySuccess = successIds.has(offerId);
      const alreadyFailed = failedEntries.some((item) => item.entry.key === entry.key);

      if (!alreadySuccess && !alreadyFailed) {
        const errorMessage =
          record.error && typeof record.error === 'object'
            ? String((record.error as { message?: unknown }).message || '')
            : '';

        failedEntries.push({
          entry,
          failure: {
            offerId,
            code: record.status === 'success'
              ? 'MISSING_BATCH_RESULT'
              : record.status || 'BATCH_FAILED',
            message: errorMessage || record.stderrText || '批量深采未返回该商品结果',
          },
        });
      }
    }

    return {
      okEntries,
      failedEntries,
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

    upsertDeepJson(item.offerId, deep, {
      status: 'success',
      profile,
      attempt,
    });
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

    setCardOverrides((prev) => ({
      ...prev,
      [key]: {
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

    upsertDeepFailure(item.offerId, {
      offerId: item.offerId,
      code,
      message,
      failedAt: new Date().toISOString(),
      attempts: [
        {
          profile,
          attempt,
          code,
          message,
        },
      ],
    });
  }

  async function runDeepCollectBatchWithFallback(entries: DeepQueueEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const profiles = await getDeepCollectProfilePool();
    let remaining = entries;

    for (let profileIndex = 0; profileIndex < profiles.length && remaining.length > 0; profileIndex += 1) {
      const profile = profiles[profileIndex]!;

      let firstResult: {
        okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }>;
        failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }>;
      };

      try {
        firstResult = await runOfferProBatchOnce(remaining, profile, 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '批量深采失败');

        firstResult = {
          okEntries: [],
          failedEntries: remaining.map((entry) => ({
            entry,
            failure: {
              offerId: entry.item.offerId,
              code: 'BATCH_EXCEPTION',
              message,
            },
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

      for (const item of firstFailed) {
        const message = `${profile} 第一次失败，重新打开浏览器进行第二次测试`;

        upsertDeepTask(item.entry.key, {
          status: 'collecting',
          profile,
          attempt: 2,
          message,
        });

        setCardOverrides((prev) => ({
          ...prev,
          [item.entry.key]: {
            status: 'deep-collecting',
            message,
            code: String(item.failure.code || ''),
          },
        }));
      }

      let secondResult: {
        okEntries: Array<{ entry: DeepQueueEntry; data: Record<string, unknown> }>;
        failedEntries: Array<{ entry: DeepQueueEntry; failure: Record<string, unknown> }>;
      };

      try {
        secondResult = await runOfferProBatchOnce(
          firstFailed.map((item) => item.entry),
          profile,
          2,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '批量深采二次测试失败');

        secondResult = {
          okEntries: [],
          failedEntries: firstFailed.map((item) => ({
            entry: item.entry,
            failure: {
              offerId: item.entry.item.offerId,
              code: 'BATCH_RETRY_EXCEPTION',
              message,
            },
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

      const nextProfile = profiles[profileIndex + 1];

      if (nextProfile) {
        for (const item of stillFailed) {
          const message = `${profile} 二次测试失败，切换到 ${nextProfile}`;

          setCardOverrides((prev) => ({
            ...prev,
            [item.entry.key]: {
              status: 'deep-collecting',
              message,
              code: String(item.failure.code || 'SWITCH_PROFILE'),
            },
          }));

          upsertDeepTask(item.entry.key, {
            status: 'collecting',
            profile,
            attempt: 2,
            message,
          });
        }

        remaining = stillFailed.map((item) => item.entry);
        await sleep(800);
        continue;
      }

      for (const item of stillFailed) {
        applyDeepFailed(item.entry, item.failure, profile, 2);
      }

      remaining = [];
    }

    showToast('深度采集队列已处理完成', 1800);
  }

  async function processDeepQueue(): Promise<void> {
    if (deepRunningRef.current) return;

    if (deepQueueStartTimerRef.current) {
      clearTimeout(deepQueueStartTimerRef.current);
      deepQueueStartTimerRef.current = null;
    }

    const batch = deepQueueRef.current.slice();

    if (batch.length === 0) return;

    deepCollectLog('processDeepQueue batch snapshot', {
      batchSize: batch.length,
      offerIds: batch.map((entry) => entry.item.offerId),
    });

    const processingKeys = new Set(batch.map((entry) => entry.key));
    deepRunningRef.current = true;

    for (const entry of batch) {
      upsertDeepTask(entry.key, {
        status: 'collecting',
        message: `等待批量深度采集启动，本批 ${batch.length} 个商品`,
      });
    }

    try {
      await runDeepCollectBatchWithFallback(batch);
    } finally {
      deepQueueRef.current = deepQueueRef.current.filter((entry) => !processingKeys.has(entry.key));
      deepRunningRef.current = false;

      if (deepQueueRef.current.length > 0) {
        scheduleDeepQueueProcess(800);
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
    onDeepTasksChange?.([]);
  }

  return {
    enqueueSingleDeepCollect,
    enqueueMultipleDeepCollect,
    resetDeepCollectQueue,
  };
}
