import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OmsManualTaskClient,
  OmsManualTaskChatSummary,
} from './oms-manual-task-client.js';

describe('OmsManualTaskClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.C2OMS_API_BASE_URL;
    delete process.env.C2OMS_API_TOKEN;
    delete process.env.C2OMS_API_TIMEOUT_MS;
  });

  it('queries chat task list with bearer token', async () => {
    const result: OmsManualTaskChatSummary[] = [
      {
        uid: 'mrt_1',
        title: '审批订单',
        taskType: 'APPROVAL',
        taskState: 'PENDING',
        priority: 'HIGH',
        planUid: 'epl_1',
        planNodeUid: 'pnd_1',
        flowUid: 'flw_1',
        availableActions: ['START'],
        summaryText: '类型:APPROVAL | 状态:PENDING | 优先级:HIGH',
      },
    ];

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, result }),
    } as Response);

    const client = new OmsManualTaskClient({
      baseUrl: 'http://127.0.0.1:7500/oms/api',
      token: 'secret-token',
    });

    await expect(
      client.queryMyManualTaskChatList({ limit: 5 }),
    ).resolves.toEqual(result);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      'http://127.0.0.1:7500/oms/api/manual-tasks/chat/my-tasks',
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer secret-token',
    );
  });

  it('throws when OMS API reports failure', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: 'forbidden' }),
    } as Response);

    const client = new OmsManualTaskClient({
      baseUrl: 'http://127.0.0.1:7500/oms/api',
    });

    await expect(client.getManualTaskChatDetail('mrt_1')).rejects.toThrow(
      'forbidden',
    );
  });
});
