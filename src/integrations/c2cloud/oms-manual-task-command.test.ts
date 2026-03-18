import { describe, expect, it, vi } from 'vitest';

import { maybeHandleOmsManualTaskCommand } from './oms-manual-task-command.js';
import { OmsManualTaskClient } from './oms-manual-task-client.js';

describe('maybeHandleOmsManualTaskCommand', () => {
  it('ignores unrelated messages', async () => {
    const sendMessage = vi.fn();
    const handled = await maybeHandleOmsManualTaskCommand({
      chatJid: 'main-chat',
      isMainGroup: true,
      message: {
        id: '1',
        chat_jid: 'main-chat',
        sender: 'user',
        sender_name: 'User',
        content: 'hello',
        timestamp: new Date().toISOString(),
      },
      sendMessage,
      client: {} as OmsManualTaskClient,
    });

    expect(handled).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('lists tasks in main group', async () => {
    const sendMessage = vi.fn();
    const client = {
      queryMyManualTaskChatList: vi.fn().mockResolvedValue([
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
      ]),
    } as unknown as OmsManualTaskClient;

    const handled = await maybeHandleOmsManualTaskCommand({
      chatJid: 'main-chat',
      isMainGroup: true,
      message: {
        id: '1',
        chat_jid: 'main-chat',
        sender: 'user',
        sender_name: 'User',
        content: '/oms-tasks',
        timestamp: new Date().toISOString(),
      },
      sendMessage,
      client,
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
