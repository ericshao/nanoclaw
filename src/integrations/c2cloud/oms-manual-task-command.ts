import { NewMessage } from '../../types.js';
import { logger } from '../../logger.js';
import {
  OmsManualTaskClient,
  OmsManualTaskChatActionType,
} from './oms-manual-task-client.js';

const OMS_TASKS_COMMAND = '/oms-tasks';
const OMS_TASK_COMMAND = '/oms-task';
const OMS_TASK_ACTION_COMMAND = '/oms-task-action';
const OMS_TASK_HELP_COMMAND = '/oms-task-help';

export interface OmsTaskCommandContext {
  chatJid: string;
  message: NewMessage;
  isMainGroup: boolean;
  sendMessage: (jid: string, text: string) => Promise<void>;
  client?: OmsManualTaskClient;
}

export async function maybeHandleOmsManualTaskCommand(
  ctx: OmsTaskCommandContext,
): Promise<boolean> {
  const trimmed = ctx.message.content.trim();
  if (
    !trimmed.startsWith(OMS_TASKS_COMMAND) &&
    !trimmed.startsWith(OMS_TASK_COMMAND) &&
    !trimmed.startsWith(OMS_TASK_ACTION_COMMAND) &&
    trimmed !== OMS_TASK_HELP_COMMAND
  ) {
    return false;
  }

  if (!ctx.isMainGroup) {
    await ctx.sendMessage(
      ctx.chatJid,
      'OMS ManualTask 命令仅允许在主控会话中执行。',
    );
    return true;
  }

  const client = ctx.client || new OmsManualTaskClient();

  try {
    if (trimmed === OMS_TASK_HELP_COMMAND) {
      await ctx.sendMessage(ctx.chatJid, buildHelpText());
      return true;
    }

    if (trimmed.startsWith(OMS_TASKS_COMMAND)) {
      await handleListCommand(trimmed, ctx, client);
      return true;
    }

    if (trimmed.startsWith(OMS_TASK_ACTION_COMMAND)) {
      await handleActionCommand(trimmed, ctx, client);
      return true;
    }

    if (trimmed.startsWith(OMS_TASK_COMMAND)) {
      await handleDetailCommand(trimmed, ctx, client);
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ err: error, command: trimmed }, 'OMS task command failed');
    await ctx.sendMessage(
      ctx.chatJid,
      `OMS ManualTask 命令执行失败: ${getErrorMessage(error)}`,
    );
    return true;
  }
}

async function handleListCommand(
  command: string,
  ctx: OmsTaskCommandContext,
  client: OmsManualTaskClient,
): Promise<void> {
  const keyword = command.slice(OMS_TASKS_COMMAND.length).trim();
  const tasks = await client.queryMyManualTaskChatList({
    keyword: keyword || undefined,
    onlyActionable: true,
    limit: 10,
  });

  if (tasks.length === 0) {
    await ctx.sendMessage(ctx.chatJid, '当前没有可处理的 OMS ManualTask。');
    return;
  }

  const lines = tasks.map(
    (task, index) =>
      `${index + 1}. ${task.uid} | ${task.title} | ${task.summaryText} | 动作:${task.availableActions.join(',') || '无'}`,
  );

  await ctx.sendMessage(
    ctx.chatJid,
    ['OMS ManualTask 列表：', ...lines].join('\n'),
  );
}

async function handleDetailCommand(
  command: string,
  ctx: OmsTaskCommandContext,
  client: OmsManualTaskClient,
): Promise<void> {
  const parts = command.split(/\s+/).filter(Boolean);
  const uid = parts[1];
  if (!uid) {
    await ctx.sendMessage(ctx.chatJid, '用法: /oms-task <taskUid>');
    return;
  }

  const task = await client.getManualTaskChatDetail(uid);
  const lines = [
    `任务: ${task.uid}`,
    `标题: ${task.title}`,
    `类型: ${task.taskType}`,
    `状态: ${task.taskState}`,
    `优先级: ${task.priority}`,
    `可用动作: ${task.availableActions.join(',') || '无'}`,
  ];

  if (task.description) {
    lines.push(`描述: ${task.description}`);
  }
  if (task.comments) {
    lines.push(`备注: ${task.comments}`);
  }
  if (task.dueAt) {
    lines.push(`截止: ${task.dueAt}`);
  }

  await ctx.sendMessage(ctx.chatJid, lines.join('\n'));
}

async function handleActionCommand(
  command: string,
  ctx: OmsTaskCommandContext,
  client: OmsManualTaskClient,
): Promise<void> {
  const { uid, action, toUserId, text } = parseActionCommand(command);

  if (!uid || !action) {
    await ctx.sendMessage(
      ctx.chatJid,
      '用法: /oms-task-action <taskUid> <START|APPROVE|REJECT|CANCEL|TRANSFER> [--to <userId>] [comment]',
    );
    return;
  }

  const result = await client.submitManualTaskChatAction(uid, {
    action,
    toUserId,
    comment: text || undefined,
    reason: text || undefined,
  });

  await ctx.sendMessage(
    ctx.chatJid,
    [
      result.message,
      `任务状态: ${result.task.taskState}`,
      `可用动作: ${result.task.availableActions.join(',') || '无'}`,
    ].join('\n'),
  );
}

function parseActionCommand(command: string): {
  uid?: string;
  action?: OmsManualTaskChatActionType;
  toUserId?: number;
  text?: string;
} {
  const parts = command.split(/\s+/).filter(Boolean);
  const uid = parts[1];
  const action = parts[2] as OmsManualTaskChatActionType | undefined;

  let toUserId: number | undefined;
  const contentParts: string[] = [];

  for (let index = 3; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '--to') {
      const value = parts[index + 1];
      if (value) {
        toUserId = Number(value);
        index += 1;
      }
      continue;
    }
    contentParts.push(part);
  }

  return {
    uid,
    action,
    toUserId,
    text: contentParts.join(' ').trim() || undefined,
  };
}

function buildHelpText(): string {
  return [
    'OMS ManualTask 命令：',
    '/oms-tasks [keyword]  查询当前可处理任务',
    '/oms-task <taskUid>  查看单任务详情',
    '/oms-task-action <taskUid> <START|APPROVE|REJECT|CANCEL|TRANSFER> [--to <userId>] [comment]',
  ].join('\n');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
