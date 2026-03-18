import fs from 'fs';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startManualTaskWebhookServer } from './manual-task-webhook.js';

async function getListeningPort(server: {
  address(): string | AddressInfo | null;
}): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get webhook test server address');
  }
  return address.port;
}

describe('startManualTaskWebhookServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards webhook payload to main groups', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const server = startManualTaskWebhookServer({
      port: 0,
      path: '/hooks/c2oms/manual-tasks',
      secret: 'secret',
      registeredGroups: () => ({
        'main@g.us': {
          name: 'main',
          folder: 'main',
          trigger: '@Andy',
          added_at: new Date().toISOString(),
          isMain: true,
        },
      }),
      sendMessage,
    });

    const port = await getListeningPort(server);

    const response = await fetch(
      `http://127.0.0.1:${port}/hooks/c2oms/manual-tasks`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nanoclaw-secret': 'secret',
        },
        body: JSON.stringify({
          subject: '新人工任务',
          content: '测试内容',
          variables: {
            eventType: 'oms:execution:ManualTask:Lifecycle:Created',
            task: {
              uid: 'mrt_1',
              title: '审批订单',
              taskState: 'PENDING',
            },
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('routes webhook payload to configured business group folder', async () => {
    const configPath = path.join(
      os.tmpdir(),
      `manual-task-routing-${Date.now()}.json`,
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        defaultTarget: 'drop',
        rules: [
          {
            tenantIds: ['1'],
            taskTypes: ['APPROVAL'],
            targetFolders: ['ops-review'],
          },
        ],
      }),
    );

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const server = startManualTaskWebhookServer({
      port: 0,
      path: '/hooks/c2oms/manual-tasks',
      secret: 'secret',
      routeConfigPath: configPath,
      registeredGroups: () => ({
        'ops@g.us': {
          name: 'ops',
          folder: 'ops-review',
          trigger: '@Andy',
          added_at: new Date().toISOString(),
        },
        'main@g.us': {
          name: 'main',
          folder: 'main',
          trigger: '@Andy',
          added_at: new Date().toISOString(),
          isMain: true,
        },
      }),
      sendMessage,
    });

    const port = await getListeningPort(server);

    const response = await fetch(
      `http://127.0.0.1:${port}/hooks/c2oms/manual-tasks`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nanoclaw-secret': 'secret',
        },
        body: JSON.stringify({
          subject: '新人工任务',
          content: '测试内容',
          variables: {
            tenantId: '1',
            eventType: 'oms:execution:ManualTask:Lifecycle:Created',
            task: {
              uid: 'mrt_2',
              title: '审批订单',
              taskState: 'PENDING',
              taskType: 'APPROVAL',
            },
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      'ops@g.us',
      expect.stringContaining('审批订单'),
    );

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.unlinkSync(configPath);
  });
});
