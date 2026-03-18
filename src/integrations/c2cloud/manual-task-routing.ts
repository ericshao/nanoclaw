import fs from 'fs';

import { logger } from '../../logger.js';
import { RegisteredGroup } from '../../types.js';

export interface ManualTaskWebhookPayload {
  notificationId?: string;
  subject?: string;
  content?: string;
  priority?: string;
  variables?: {
    source?: string;
    eventType?: string;
    tenantId?: string | number;
    task?: {
      uid?: string;
      title?: string;
      result?: string;
      taskState?: string;
      taskType?: string;
      priority?: string;
      assigneeUsers?: number[];
      assigneeRoles?: string[];
    };
  };
  sentAt?: string;
}

export interface ManualTaskRouteRule {
  name?: string;
  tenantIds?: Array<string | number>;
  eventTypes?: string[];
  taskTypes?: string[];
  targetJids?: string[];
  targetFolders?: string[];
}

export interface ManualTaskRoutingConfig {
  defaultTarget?: 'main-groups' | 'drop';
  rules?: ManualTaskRouteRule[];
}

export function resolveManualTaskWebhookTargets(
  payload: ManualTaskWebhookPayload,
  registeredGroups: Record<string, RegisteredGroup>,
  configPath?: string,
): string[] {
  const routingConfig = loadManualTaskRoutingConfig(configPath);
  const matchedTargets = new Set<string>();

  for (const rule of routingConfig.rules || []) {
    if (!matchesRule(rule, payload)) {
      continue;
    }

    for (const jid of rule.targetJids || []) {
      if (registeredGroups[jid]) {
        matchedTargets.add(jid);
      }
    }

    for (const folder of rule.targetFolders || []) {
      for (const [jid, group] of Object.entries(registeredGroups)) {
        if (group.folder === folder) {
          matchedTargets.add(jid);
        }
      }
    }
  }

  if (matchedTargets.size > 0) {
    return [...matchedTargets];
  }

  if (routingConfig.defaultTarget === 'drop') {
    return [];
  }

  return Object.entries(registeredGroups)
    .filter(([, group]) => group.isMain)
    .map(([jid]) => jid);
}

export function loadManualTaskRoutingConfig(
  configPath?: string,
): ManualTaskRoutingConfig {
  if (!configPath) {
    return { defaultTarget: 'main-groups', rules: [] };
  }

  try {
    if (!fs.existsSync(configPath)) {
      return { defaultTarget: 'main-groups', rules: [] };
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as ManualTaskRoutingConfig;
    return {
      defaultTarget: parsed.defaultTarget || 'main-groups',
      rules: parsed.rules || [],
    };
  } catch (error) {
    logger.warn(
      { err: error, configPath },
      'Failed to load manual task routing config, fallback to main groups',
    );
    return { defaultTarget: 'main-groups', rules: [] };
  }
}

function matchesRule(
  rule: ManualTaskRouteRule,
  payload: ManualTaskWebhookPayload,
): boolean {
  const tenantId = payload.variables?.tenantId;
  const eventType = payload.variables?.eventType;
  const taskType = payload.variables?.task?.taskType;

  if (rule.tenantIds?.length) {
    const matched = rule.tenantIds.some(
      (item) => String(item) === String(tenantId),
    );
    if (!matched) {
      return false;
    }
  }

  if (rule.eventTypes?.length && eventType) {
    if (!rule.eventTypes.includes(eventType)) {
      return false;
    }
  } else if (rule.eventTypes?.length) {
    return false;
  }

  if (rule.taskTypes?.length && taskType) {
    if (!rule.taskTypes.includes(taskType)) {
      return false;
    }
  } else if (rule.taskTypes?.length) {
    return false;
  }

  return true;
}
