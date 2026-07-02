import { describe, expect, it, beforeEach } from 'vitest';
import {
  __deepCollectSessionTest,
  getDeepCollectSessionSnapshot,
  hasDeepCollectSessionState,
} from '../apps/desktop/renderer/src/components/Results/deepCollect/useDeepCollectQueue';
import {
  __ozonListingSessionTest,
  getOzonListingSessionTasks,
  hasOzonListingSessionState,
} from '../apps/desktop/renderer/src/components/Results/ozonListing/useOzonListingQueue';

describe('renderer task sessions', () => {
  beforeEach(() => {
    __deepCollectSessionTest.resetAll();
    __ozonListingSessionTest.resetAll();
  });

  it('keeps deep collect card and sidebar state by run id across renderer remounts', () => {
    const sessionKey = 'record:desktop-deeppro-base-123';
    const createdAt = new Date('2026-07-01T07:00:00.000Z').toISOString();

    __deepCollectSessionTest.seed(sessionKey, {
      cardOverrides: {
        'offer:1001': {
          status: 'deep-queued',
          message: '排队等待深度采集',
        },
      },
      tasks: [
        {
          key: 'offer:1001',
          sidebarKey: 'deep-session::offer:1001',
          offerId: '1001',
          title: '测试裤子',
          status: 'queued',
          message: '排队等待深度采集',
          createdAt,
        },
      ],
    });

    expect(hasDeepCollectSessionState(sessionKey)).toBe(true);

    const remountSnapshot = getDeepCollectSessionSnapshot(sessionKey);
    expect(remountSnapshot.cardOverrides['offer:1001']?.status).toBe('deep-queued');
    expect(remountSnapshot.cardOverrides['offer:1001']?.message).toBe('排队等待深度采集');
    expect(remountSnapshot.tasks).toHaveLength(1);
    expect(remountSnapshot.tasks[0]?.status).toBe('queued');
    expect(hasDeepCollectSessionState('record:another-run')).toBe(false);
  });

  it('sends deep collect task and card updates to the latest renderer binding', () => {
    const sessionKey = 'record:desktop-deeppro-base-456';
    const createdAt = new Date('2026-07-01T07:02:00.000Z').toISOString();
    const staleCardUpdates: unknown[] = [];
    const latestCardUpdates: unknown[] = [];
    const staleTaskUpdates: unknown[] = [];
    const latestTaskUpdates: unknown[] = [];

    __deepCollectSessionTest.seed(sessionKey, {
      tasks: [
        {
          key: 'offer:1002',
          sidebarKey: 'deep-session::offer:1002',
          offerId: '1002',
          title: '旧绑定测试裤子',
          status: 'queued',
          message: '排队等待深度采集',
          createdAt,
        },
      ],
    });

    __deepCollectSessionTest.bind(sessionKey, {
      setCardOverrides: (value) => staleCardUpdates.push(value),
      onDeepTasksChange: (tasks) => staleTaskUpdates.push(tasks),
    });

    __deepCollectSessionTest.bind(sessionKey, {
      setCardOverrides: (value) => latestCardUpdates.push(value),
      onDeepTasksChange: (tasks) => latestTaskUpdates.push(tasks),
    });

    __deepCollectSessionTest.applyCardOverrides(sessionKey, {
      'offer:1002': {
        status: 'deep-success',
        message: '深度采集完成',
      },
    });
    __deepCollectSessionTest.publishTasks(sessionKey);

    expect(staleCardUpdates).toHaveLength(0);
    expect(staleTaskUpdates).toHaveLength(0);
    expect(latestCardUpdates).toHaveLength(1);
    expect(latestTaskUpdates).toHaveLength(1);
    expect((latestCardUpdates[0] as Record<string, { status?: string }>)['offer:1002']?.status).toBe('deep-success');
    expect((latestTaskUpdates[0] as Array<{ offerId?: string }>)[0]?.offerId).toBe('1002');
  });

  it('keeps ozon listing sidebar state by run id across renderer remounts', () => {
    const sessionKey = 'record:desktop-deeppro-base-123:ozon';
    const createdAt = new Date('2026-07-01T07:01:00.000Z').toISOString();

    __ozonListingSessionTest.seed(sessionKey, [
      {
        key: 'offer:1001',
        sidebarKey: 'ozon-session::offer:1001',
        offerId: '1001',
        title: '测试裤子',
        status: 'deep_collecting',
        message: '已加入深度采集队列，采集成功后生成 Ozon 草稿',
        createdAt,
      },
    ]);

    expect(hasOzonListingSessionState(sessionKey)).toBe(true);

    const remountTasks = getOzonListingSessionTasks(sessionKey);
    expect(remountTasks).toHaveLength(1);
    expect(remountTasks[0]?.status).toBe('deep_collecting');
    expect(remountTasks[0]?.message).toContain('生成 Ozon 草稿');
    expect(hasOzonListingSessionState('record:another-run:ozon')).toBe(false);
  });
});
