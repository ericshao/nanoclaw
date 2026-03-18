import { IncomingMessage, ServerResponse, createServer } from 'http';
import { createHash } from 'crypto';

import { logger } from '../../logger.js';
import { RegisteredGroup } from '../../types.js';
import {
  ManualTaskWebhookPayload,
  resolveManualTaskWebhookTargets,
} from './manual-task-routing.js';

export interface ManualTaskWebhookServerOptions {
  port: number;
  host?: string;
  path?: string;
  secret?: string;
  routeConfigPath?: string;
  registeredGroups: () => Record<string, RegisteredGroup>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

export function startManualTaskWebhookServer(
  options: ManualTaskWebhookServerOptions,
) {
  const host = options.host || '127.0.0.1';
  const path = options.path || '/hooks/c2oms/manual-tasks';

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== path) {
        respond(res, 404, { ok: false, error: 'Not Found' });
        return;
      }

      if (options.secret) {
        const provided = req.headers['x-nanoclaw-secret'];
        if (provided !== options.secret) {
          respond(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
      }

      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody) as ManualTaskWebhookPayload;
      const message = formatWebhookMessage(payload);

      const targetJids = resolveManualTaskWebhookTargets(
        payload,
        options.registeredGroups(),
        options.routeConfigPath,
      );

      if (targetJids.length === 0) {
        logger.warn(
          { payload },
          'Manual task webhook received but no route target matched',
        );
      }

      await Promise.all(
        targetJids.map((jid) => options.sendMessage(jid, message)),
      );

      respond(res, 200, {
        ok: true,
        delivered: targetJids.length,
        digest: buildDigest(payload),
      });
    } catch (error) {
      logger.error({ err: error }, 'Manual task webhook server error');
      respond(res, 500, { ok: false, error: getErrorMessage(error) });
    }
  });

  server.listen(options.port, host, () => {
    logger.info(
      { host, port: options.port, path },
      'Manual task webhook server started',
    );
  });

  return server;
}

function respond(res: ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function formatWebhookMessage(payload: ManualTaskWebhookPayload): string {
  const title =
    payload.variables?.task?.title || payload.subject || '人工任务通知';
  const eventType = payload.variables?.eventType || 'UNKNOWN';
  const taskUid = payload.variables?.task?.uid;

  const lines = [`OMS ManualTask 推送`, `标题: ${title}`, `事件: ${eventType}`];

  if (taskUid) {
    lines.push(`任务: ${taskUid}`);
  }
  if (payload.variables?.task?.taskState) {
    lines.push(`状态: ${payload.variables.task.taskState}`);
  }
  if (payload.variables?.task?.result) {
    lines.push(`结果: ${payload.variables.task.result}`);
  }
  if (payload.content) {
    lines.push('', payload.content);
  }

  return lines.join('\n');
}

function buildDigest(payload: ManualTaskWebhookPayload): string {
  return createHash('sha1')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 12);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
