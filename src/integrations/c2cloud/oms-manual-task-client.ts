import { readEnvFile } from '../../env.js';
import { logger } from '../../logger.js';

export type OmsManualTaskState =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type OmsManualTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type OmsManualTaskChatActionType =
  | 'START'
  | 'APPROVE'
  | 'REJECT'
  | 'CANCEL'
  | 'TRANSFER';

export interface QueryOmsManualTaskChatListInput {
  keyword?: string;
  taskStates?: OmsManualTaskState[];
  priorities?: OmsManualTaskPriority[];
  includeCompleted?: boolean;
  onlyActionable?: boolean;
  limit?: number;
}

export interface OmsManualTaskChatSummary {
  uid: string;
  title: string;
  description?: string;
  taskType: string;
  taskState: OmsManualTaskState;
  priority: OmsManualTaskPriority;
  planUid: string;
  planNodeUid: string;
  flowUid: string;
  dueAt?: string;
  completedAt?: string;
  result?: 'APPROVED' | 'REJECTED' | 'CANCELLED';
  assigneeUsers?: number[];
  assigneeRoles?: string[];
  availableActions: OmsManualTaskChatActionType[];
  summaryText: string;
}

export interface OmsManualTaskChatDetail extends OmsManualTaskChatSummary {
  comments?: string;
  taskData?: Record<string, unknown>;
  formSchema?: Record<string, unknown>;
  formData?: Record<string, unknown>;
  attachments?: Array<{
    name: string;
    url: string;
    size?: number;
    mimeType?: string;
  }>;
  allowDelegation: boolean;
  allowRevocation: boolean;
  reminderCount: number;
  expectedAt?: string;
  completedBy?: number;
  completedByName?: string;
  createdDate: string;
  lastUpdatedDate: string;
}

export interface SubmitOmsManualTaskChatActionInput {
  action: OmsManualTaskChatActionType;
  comment?: string;
  reason?: string;
  toUserId?: number;
  formData?: Record<string, unknown>;
  attachments?: Array<{
    name: string;
    url: string;
    size?: number;
    mimeType?: string;
  }>;
}

export interface OmsManualTaskChatActionResult {
  uid: string;
  action: OmsManualTaskChatActionType;
  message: string;
  task: OmsManualTaskChatSummary;
}

interface OmsApiEnvelope<T> {
  success?: boolean;
  result?: T;
  message?: string;
}

export interface OmsManualTaskClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export class OmsManualTaskClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(options: OmsManualTaskClientOptions = {}) {
    const env = readEnvFile([
      'C2OMS_API_BASE_URL',
      'C2OMS_API_TOKEN',
      'C2OMS_API_TIMEOUT_MS',
    ]);

    this.baseUrl = (
      options.baseUrl ||
      process.env.C2OMS_API_BASE_URL ||
      env.C2OMS_API_BASE_URL ||
      'http://127.0.0.1:7500/oms/api'
    ).replace(/\/$/, '');
    this.token =
      options.token || process.env.C2OMS_API_TOKEN || env.C2OMS_API_TOKEN;
    this.timeoutMs = Number(
      options.timeoutMs ||
        process.env.C2OMS_API_TIMEOUT_MS ||
        env.C2OMS_API_TIMEOUT_MS ||
        15000,
    );
  }

  async queryMyManualTaskChatList(
    input: QueryOmsManualTaskChatListInput = {},
  ): Promise<OmsManualTaskChatSummary[]> {
    return this.request<OmsManualTaskChatSummary[]>(
      '/manual-tasks/chat/my-tasks',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  async getManualTaskChatDetail(uid: string): Promise<OmsManualTaskChatDetail> {
    return this.request<OmsManualTaskChatDetail>(
      `/manual-tasks/chat/${encodeURIComponent(uid)}/detail`,
      {
        method: 'POST',
      },
    );
  }

  async submitManualTaskChatAction(
    uid: string,
    input: SubmitOmsManualTaskChatActionInput,
  ): Promise<OmsManualTaskChatActionResult> {
    return this.request<OmsManualTaskChatActionResult>(
      `/manual-tasks/chat/${encodeURIComponent(uid)}/action`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  private async request<T>(pathname: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.token) {
      headers.set('authorization', `Bearer ${this.token}`);
    }

    const url = `${this.baseUrl}${pathname}`;
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to reach OMS manual task API at ${url}: ${message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      logger.warn(
        { url, status: response.status, body: body.slice(0, 500) },
        'OMS manual task API returned non-OK status',
      );
      throw new Error(`OMS manual task API request failed: ${response.status}`);
    }

    const payload = (await response.json()) as OmsApiEnvelope<T>;
    if (payload.success === false) {
      throw new Error(
        payload.message || 'OMS manual task API returned failure',
      );
    }

    if (typeof payload.result === 'undefined') {
      throw new Error('OMS manual task API returned empty result');
    }

    return payload.result;
  }
}
