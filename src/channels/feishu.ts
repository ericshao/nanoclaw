import * as lark from '@larksuiteoapi/node-sdk';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

export interface FeishuChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class FeishuChannel implements Channel {
  name = 'feishu';

  private client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private opts: FeishuChannelOpts;
  private appId: string;
  private appSecret: string;
  private isConnectedFlag = false;

  constructor(appId: string, appSecret: string, opts: FeishuChannelOpts) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const baseConfig = {
      appId: this.appId,
      appSecret: this.appSecret,
    };

    this.client = new lark.Client(baseConfig);
    this.wsClient = new lark.WSClient({
      ...baseConfig,
      loggerLevel: lark.LoggerLevel.info,
    });

    // Set up event dispatcher for message events
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await this.handleMessage(data);
      },
    });

    return new Promise<void>((resolve, reject) => {
      // Use type assertion as the SDK types may not include all options
      const wsOptions: any = {
        eventDispatcher,
        onStart: () => {
          this.isConnectedFlag = true;
          logger.info('Feishu bot connected');
          console.log(`\n  Feishu bot connected (App ID: ${this.appId})`);
          console.log(`  Use /chatid command in Feishu to get chat IDs\n`);
          resolve();
        },
        onError: (error: Error) => {
          logger.error({ err: error }, 'Feishu WebSocket error');
          reject(error);
        },
      };

      this.wsClient!.start(wsOptions);
    });
  }

  private async handleMessage(data: any): Promise<void> {
    try {
      const message = data?.message;
      if (!message) {
        logger.debug('Received Feishu event without message');
        return;
      }

      const {
        message_id: msgId,
        chat_id: chatId,
        sender,
        content: contentJson,
        msg_type: msgType,
        create_time: createTime,
      } = message;

      // Parse sender info
      const senderId = sender?.sender_id?.open_id || sender?.id || 'unknown';
      const senderType = sender?.sender_type || 'user';

      // Skip bot's own messages
      if (senderType === 'app') {
        return;
      }

      // Parse content based on message type
      let content = '';
      let chatName = `Feishu Chat ${chatId}`;

      try {
        const parsedContent = JSON.parse(contentJson);

        if (msgType === 'text') {
          content = parsedContent.text || '';
        } else if (msgType === 'post') {
          // Rich text format - extract text content
          content = this.extractTextFromPost(parsedContent);
        } else if (msgType === 'image') {
          content = '[Image]';
        } else if (msgType === 'file') {
          content = `[File: ${parsedContent.file_name || 'unknown'}]`;
        } else if (msgType === 'audio') {
          content = '[Audio/Voice message]';
        } else {
          content = `[${msgType} message]`;
        }
      } catch (e) {
        logger.debug(
          { err: e, contentJson },
          'Failed to parse Feishu message content',
        );
        content = '[Unable to parse message content]';
      }

      // Get sender name - try to fetch from API if possible
      let senderName = senderId;
      try {
        const userRes = await this.client!.contact.user.get({
          params: {
            user_id_type: 'open_id',
          },
          path: {
            user_id: senderId,
          },
        });
        if (userRes.data?.user?.name) {
          senderName = userRes.data.user.name;
        }
      } catch {
        // Use sender ID as fallback
        senderName = senderId.slice(0, 8);
      }

      // Get chat info
      try {
        const chatRes = await this.client!.im.chat.get({
          path: {
            chat_id: chatId,
          },
        });
        if (chatRes.data?.name) {
          chatName = chatRes.data.name;
        }
      } catch {
        // Keep default chat name
      }

      const chatJid = `feishu:${chatId}`;
      const timestamp = new Date(parseInt(createTime)).toISOString();

      // Translate @bot mentions into TRIGGER_PATTERN format
      if (this.client) {
        try {
          // Get bot info using the bot API
          const botRes = await (this.client as any).bot.botInfo();
          const botOpenId = botRes.data?.bot?.open_id;
          if (botOpenId) {
            const atPattern = new RegExp(
              `<at open_id="${botOpenId}">.*?</at>`,
              'g',
            );
            const isBotMentioned = atPattern.test(content);

            if (isBotMentioned) {
              // Strip the @mention and prepend trigger
              content = content.replace(atPattern, '').trim();
              if (!TRIGGER_PATTERN.test(content)) {
                content = `@${ASSISTANT_NAME} ${content}`;
              }
            }
          }
        } catch (err) {
          logger.debug({ err }, 'Failed to get bot info for mention handling');
        }
      }

      // Store chat metadata for discovery
      // Determine if it's a group chat (p2p is 1:1 chat)
      const isGroup = chatId.startsWith('oc_');
      this.opts.onChatMetadata(chatJid, timestamp, chatName, 'feishu', isGroup);

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Feishu chat',
        );
        return;
      }

      // Deliver message
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender: senderId,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Feishu message stored',
      );
    } catch (err) {
      logger.error({ err }, 'Error handling Feishu message');
    }
  }

  private extractTextFromPost(postContent: any): string {
    // Extract plain text from rich text post format
    try {
      const content = postContent.content || postContent;
      if (typeof content === 'string') {
        return content;
      }

      let text = '';
      const traverse = (obj: any) => {
        if (typeof obj === 'string') {
          text += obj;
        } else if (Array.isArray(obj)) {
          obj.forEach(traverse);
        } else if (typeof obj === 'object' && obj !== null) {
          if (obj.tag === 'text' && obj.text) {
            text += obj.text;
          } else {
            Object.values(obj).forEach(traverse);
          }
        }
      };
      traverse(content);
      return text || '[Rich text message]';
    } catch {
      return '[Rich text message]';
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.client) {
      logger.warn('Feishu client not initialized');
      return;
    }

    try {
      const chatId = jid.replace(/^feishu:/, '');

      // Feishu has a 20000 character limit per text message
      const MAX_LENGTH = 20000;
      const chunks = [];
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        chunks.push(text.slice(i, i + MAX_LENGTH));
      }

      for (const chunk of chunks) {
        await this.client.im.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: chunk }),
            msg_type: 'text',
          },
        });
      }

      logger.info({ jid, length: text.length }, 'Feishu message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Feishu message');
    }
  }

  isConnected(): boolean {
    return this.isConnectedFlag && this.wsClient !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      try {
        // Use type assertion as stop method may not be in types
        await (this.wsClient as any).stop?.();
      } catch {
        // Ignore stop errors
      }
      this.wsClient = null;
    }
    this.isConnectedFlag = false;
    logger.info('Feishu bot disconnected');
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    // Feishu doesn't have a direct typing indicator API for bots
    // We could send a "typing" card but it's not standard
    // Leaving as no-op for now
  }
}

registerChannel('feishu', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
  const appId = process.env.FEISHU_APP_ID || envVars.FEISHU_APP_ID || '';
  const appSecret =
    process.env.FEISHU_APP_SECRET || envVars.FEISHU_APP_SECRET || '';

  if (!appId || !appSecret) {
    logger.warn('Feishu: FEISHU_APP_ID or FEISHU_APP_SECRET not set');
    return null;
  }

  return new FeishuChannel(appId, appSecret, opts);
});
