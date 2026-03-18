import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

// Mock registry (registerChannel runs at import time)
vi.mock('./registry.js', () => ({ registerChannel: vi.fn() }));

// Mock env reader (used by the factory, not needed in unit tests)
vi.mock('../env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));

// Mock config
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'TestBot',
  TRIGGER_PATTERN: /^@TestBot\b/,
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// --- lark SDK mock ---

type Handler = (...args: any[]) => any;

const clientRef = vi.hoisted(() => ({ current: null as any }));
const wsClientRef = vi.hoisted(() => ({ current: null as any }));
const dispatcherRef = vi.hoisted(() => ({ current: null as any }));

vi.mock('@larksuiteoapi/node-sdk', () => {
  const LoggerLevel = {
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
  };

  const AppType = {
    SelfBuild: 'self_build',
    ISV: 'isv',
  };

  const Domain = {
    Feishu: 'https://open.feishu.cn',
    Lark: 'https://open.larksuite.com',
  };

  class MockEventDispatcher {
    handlers = new Map<string, Handler>();

    register(mapping: Record<string, Handler>) {
      Object.entries(mapping).forEach(([event, handler]) => {
        this.handlers.set(event, handler);
      });
      dispatcherRef.current = this;
      return this;
    }
  }

  class MockClient {
    contact = {
      user: {
        get: vi.fn().mockResolvedValue({
          data: {
            user: {
              name: 'Test User',
            },
          },
        }),
      },
    };

    im = {
      chat: {
        get: vi.fn().mockResolvedValue({
          data: {
            name: 'Test Chat',
          },
        }),
      },
      message: {
        create: vi
          .fn()
          .mockResolvedValue({ data: { message_id: 'test_msg_123' } }),
      },
    };

    bot = {
      botInfo: vi.fn().mockResolvedValue({
        data: {
          bot: {
            open_id: 'bot_open_id_123',
          },
        },
      }),
    };

    constructor(_opts: any) {
      clientRef.current = this;
    }
  }

  class MockWSClient {
    private _started = false;
    private _opts: any;

    constructor(_opts: any) {
      wsClientRef.current = this;
      this._opts = _opts;
    }

    start(opts: any) {
      this._started = true;
      // Simulate connection success
      setTimeout(() => {
        opts?.onStart?.();
      }, 0);
      return Promise.resolve();
    }

    stop() {
      this._started = false;
      return Promise.resolve();
    }

    isStarted() {
      return this._started;
    }
  }

  return {
    Client: MockClient,
    WSClient: MockWSClient,
    EventDispatcher: MockEventDispatcher,
    LoggerLevel,
    AppType,
    Domain,
  };
});

// Import after mocks
import { FeishuChannel } from './feishu.js';

describe('FeishuChannel', () => {
  let channel: FeishuChannel;
  let mockOpts: any;

  beforeEach(() => {
    mockOpts = {
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: vi.fn().mockReturnValue({}),
    };
    channel = new FeishuChannel('test_app_id', 'test_app_secret', mockOpts);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await channel.disconnect();
    } catch {
      // Ignore disconnect errors in cleanup
    }
  });

  describe('constructor', () => {
    it('should initialize with correct name', () => {
      expect(channel.name).toBe('feishu');
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
    });

    it('should create client and wsClient', async () => {
      await channel.connect();
      expect(clientRef.current).toBeTruthy();
      expect(wsClientRef.current).toBeTruthy();
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      await channel.connect();
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('ownsJid', () => {
    it('should return true for feishu: prefixed JIDs', () => {
      expect(channel.ownsJid('feishu:oc_123456')).toBe(true);
      expect(channel.ownsJid('feishu:ou_abcdef')).toBe(true);
    });

    it('should return false for non-feishu JIDs', () => {
      expect(channel.ownsJid('dc:123456')).toBe(false);
      expect(channel.ownsJid('tg:123456')).toBe(false);
      expect(channel.ownsJid('whatsapp:123456')).toBe(false);
    });
  });

  describe('sendMessage', () => {
    beforeEach(async () => {
      await channel.connect();
    });

    it('should send message to correct chat', async () => {
      await channel.sendMessage('feishu:oc_123456', 'Hello Feishu!');
      expect(clientRef.current.im.message.create).toHaveBeenCalled();
    });

    it('should handle long messages by splitting', async () => {
      const longMessage = 'a'.repeat(25000);
      await channel.sendMessage('feishu:oc_123456', longMessage);
      // Should be called twice for split message
      expect(clientRef.current.im.message.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleMessage', () => {
    beforeEach(async () => {
      await channel.connect();
    });

    it('should ignore bot messages', async () => {
      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'bot_123' },
            sender_type: 'app',
          },
          content: JSON.stringify({ text: 'Hello' }),
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      // Trigger the registered handler
      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      expect(mockOpts.onMessage).not.toHaveBeenCalled();
    });

    it('should process text messages from registered groups', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({ text: 'Hello bot!' }),
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      expect(mockOpts.onMessage).toHaveBeenCalled();
      expect(mockOpts.onChatMetadata).toHaveBeenCalled();
    });

    it('should skip messages from unregistered groups', async () => {
      mockOpts.registeredGroups.mockReturnValue({});

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_unknown',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({ text: 'Hello!' }),
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      expect(mockOpts.onMessage).not.toHaveBeenCalled();
    });

    it('should handle @bot mentions', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({
            text: '<at open_id="bot_open_id_123">@TestBot</at> help me',
          }),
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const callArgs = mockOpts.onMessage.mock.calls[0];
      expect(callArgs[1].content).toContain('@TestBot');
    });

    it('should handle image messages', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({ image_key: 'img_123' }),
          msg_type: 'image',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const callArgs = mockOpts.onMessage.mock.calls[0];
      expect(callArgs[1].content).toBe('[Image]');
    });

    it('should handle file messages', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({
            file_key: 'file_123',
            file_name: 'document.pdf',
          }),
          msg_type: 'file',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const callArgs = mockOpts.onMessage.mock.calls[0];
      expect(callArgs[1].content).toContain('[File:');
      expect(callArgs[1].content).toContain('document.pdf');
    });

    it('should handle audio messages', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({ file_key: 'audio_123' }),
          msg_type: 'audio',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const callArgs = mockOpts.onMessage.mock.calls[0];
      expect(callArgs[1].content).toBe('[Audio/Voice message]');
    });

    it('should handle post (rich text) messages', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const postContent = {
        content: [
          {
            tag: 'text',
            text: 'Hello from rich text',
          },
        ],
      };

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify(postContent),
          msg_type: 'post',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const callArgs = mockOpts.onMessage.mock.calls[0];
      expect(callArgs[1].content).toContain('Hello from rich text');
    });

    it('should handle messages without data', async () => {
      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(null);
      }
      expect(mockOpts.onMessage).not.toHaveBeenCalled();
    });

    it('should handle messages without message property', async () => {
      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler({ other: 'data' });
      }
      expect(mockOpts.onMessage).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON content', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456',
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: 'not valid json',
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const callArgs = mockOpts.onMessage.mock.calls[0];
      expect(callArgs[1].content).toBe('[Unable to parse message content]');
    });

    it('should identify group chats correctly', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:oc_123456': {
          name: 'Test Group',
          folder: 'feishu_test',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'oc_123456', // starts with oc_ = group
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({ text: 'Hello!' }),
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const metadataCall = mockOpts.onChatMetadata.mock.calls[0];
      expect(metadataCall[4]).toBe(true); // isGroup = true
    });

    it('should identify p2p chats correctly', async () => {
      mockOpts.registeredGroups.mockReturnValue({
        'feishu:ou_123456': {
          name: 'Test User',
          folder: 'feishu_user',
          trigger: '@TestBot',
        },
      });

      const mockData = {
        message: {
          message_id: 'msg_123',
          chat_id: 'ou_123456', // starts with ou_ = p2p
          sender: {
            sender_id: { open_id: 'ou_abc123' },
            sender_type: 'user',
          },
          content: JSON.stringify({ text: 'Hello!' }),
          msg_type: 'text',
          create_time: Date.now().toString(),
        },
      };

      const handler = dispatcherRef.current?.handlers.get(
        'im.message.receive_v1',
      );
      if (handler) {
        await handler(mockData);
      }
      const metadataCall = mockOpts.onChatMetadata.mock.calls[0];
      expect(metadataCall[4]).toBe(false); // isGroup = false
    });
  });

  describe('extractTextFromPost', () => {
    it('should extract text from post content', () => {
      const postContent = {
        content: [
          {
            tag: 'text',
            text: 'Hello ',
          },
          {
            tag: 'text',
            text: 'World',
          },
        ],
      };

      const result = (channel as any).extractTextFromPost(postContent);
      expect(result).toBe('Hello World');
    });

    it('should handle string content', () => {
      const result = (channel as any).extractTextFromPost({
        content: 'Plain text',
      });
      expect(result).toBe('Plain text');
    });

    it('should handle empty content', () => {
      const result = (channel as any).extractTextFromPost({});
      expect(result).toBe('[Rich text message]');
    });

    it('should handle deeply nested content', () => {
      const postContent = {
        content: {
          nested: {
            tag: 'text',
            text: 'Deep text',
          },
        },
      };

      const result = (channel as any).extractTextFromPost(postContent);
      expect(result).toBe('Deep text');
    });
  });

  describe('setTyping', () => {
    it('should be a no-op', async () => {
      await channel.setTyping('feishu:oc_123456', true);
      // No error should be thrown
    });
  });
});
