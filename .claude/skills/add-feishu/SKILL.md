---
name: add-feishu
description: Add Feishu (Lark) as a channel. Can replace other channels entirely or run alongside them. Uses WebSocket long connection (no public URL needed).
---

# Add Feishu Channel

This skill adds Feishu/Lark support to NanoClaw, then walks through interactive setup.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/feishu.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have a Feishu app configured with App ID and App Secret, or do you need to create one?

If they have credentials, collect them now. If not, we'll create one in Phase 3.

## Phase 2: Apply Code Changes

### Ensure channel remote

```bash
git remote -v
```

If `feishu` is missing, add it:

```bash
git remote add feishu https://github.com/stephanz1101/nanoclaw-skill-feishu.git
```

### Merge the skill branch

```bash
git fetch feishu main
git merge feishu/main || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue
}
```

Or if the files already exist locally (manual installation):
- `src/channels/feishu.ts` (FeishuChannel class with self-registration via `registerChannel`)
- `src/channels/feishu.test.ts` (unit tests)
- `import './feishu.js'` in the channel barrel file `src/channels/index.ts`
- `@larksuiteoapi/node-sdk` npm dependency in `package.json`
- `FEISHU_APP_ID` and `FEISHU_APP_SECRET` in `.env.example`

### Validate code changes

```bash
npm install
npm run build
npx vitest run src/channels/feishu.test.ts
```

All tests must pass (including the new Feishu tests) and build must be clean before proceeding.

## Phase 3: Setup

### Create Feishu App (if needed)

If the user doesn't have a Feishu app, tell them:

> I need you to create a Feishu application:
>
> 1. Go to [Feishu Open Platform](https://open.feishu.cn/app) (or [Lark Open Platform](https://open.larksuite.com/app) for international)
> 2. Click **Create App** → **Enterprise Self-built App**
> 3. Enter app name and description
> 4. From the app details page, copy the **App ID** and **App Secret**
> 5. Go to **Permissions & Scopes** and add these required permissions:
>    - `im:message:send` - Send messages
>    - `im:message.group_msg` - Receive group messages
>    - `im:message.p2p_msg` - Receive private messages
>    - `contact:user.base:readonly` - Get user basic info
>    - `im:chat:readonly` - Get chat info
> 6. Go to **Event Subscriptions** and enable these events:
>    - `im.message.receive_v1` - Message reception event
> 7. Go to **Distribution & Version Management** and click **Create Version**
> 8. Set availability to **All employees** or specific members
> 9. Publish the app

Wait for the user to provide both App ID and App Secret.

### Configure environment

Add to `.env`:

```bash
FEISHU_APP_ID=cli_xxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
```

Channels auto-enable when their credentials are present — no extra configuration needed.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Registration

### Get Chat ID

Tell the user:

> 1. Add the bot to a Feishu group chat or start a direct message
> 2. Send `/chatid` in the chat — the bot will reply with the chat ID
> 3. The chat ID format is usually:
>    - Group chats: `oc_xxxxxxxxxxxxxxxx` (starts with `oc_`)
>    - Private chats: `ou_xxxxxxxxxxxxxxxx` (starts with `ou_`)
>
> The JID format for NanoClaw is: `feishu:<chat-id>`
> Examples:
> - `feishu:oc_12345678901234567890` (group)
> - `feishu:ou_12345678901234567890` (private)

Wait for the user to provide the chat ID.

### Register the chat

The chat ID, name, and folder name are needed. Use `npx tsx setup/index.ts --step register` with the appropriate flags.

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_main" --trigger "@${ASSISTANT_NAME}" --channel feishu --no-trigger-required --is-main
```

For additional chats (trigger-only):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_<group-name>" --trigger "@${ASSISTANT_NAME}" --channel feishu
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Feishu chat:
> - For main chat: Any message works
> - For non-main: `@<assistant-name> hello` or @mention the bot
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

Check:
1. `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are set in `.env` AND synced to `data/env/env`
2. Chat is registered in SQLite (check with: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'feishu:%'"`)
3. For non-main chats: message includes trigger pattern
4. Service is running: `launchctl list | grep nanoclaw` (macOS) or `systemctl --user status nanoclaw` (Linux)
5. App has required permissions granted in Feishu Open Platform
6. App is published and available to the user

### Bot not receiving messages

1. Verify event subscription is enabled in the Feishu app settings
2. Verify `im.message.receive_v1` event is subscribed
3. Verify the bot has been added to the group chat
4. Check that the app has the required OAuth scopes
5. Try republishing the app after permission changes

### Getting chat ID

If `/chatid` doesn't work:
- Make sure the bot is in the conversation
- Check bot logs for received messages: `tail -f logs/nanoclaw.log | grep Feishu`
- You can find chat IDs in the Feishu developer console under **Logs & Monitoring** → **Event Logs**

## After Setup

The Feishu channel supports:
- **Group chats** — Bot must be added to the group
- **Private messages** — Users can DM the bot directly
- **Multi-channel** — Can run alongside Discord or other channels (auto-enabled by credentials)

## Supported Message Types

The Feishu channel handles these message types:
- **Text** — Plain text messages
- **Post** — Rich text messages (text extracted)
- **Image** — `[Image]` placeholder sent to agent
- **File** — `[File: filename]` placeholder sent to agent
- **Audio** — `[Audio/Voice message]` placeholder sent to agent

## Known Limitations

- **No typing indicator** — Feishu Bot API does not expose a typing indicator endpoint. The `setTyping()` method is a no-op.
- **Message splitting** — Long messages are split at 20000-character boundary (Feishu limit)
- **No thread support** — Threaded replies are delivered as regular channel messages
- **Image/file content** — Only placeholders are sent to the agent, not actual file content

## Removal

To remove Feishu integration:

1. Delete `src/channels/feishu.ts` and `src/channels/feishu.test.ts`
2. Remove `import './feishu.js'` from `src/channels/index.ts`
3. Remove `FEISHU_APP_ID` and `FEISHU_APP_SECRET` from `.env`
4. Remove Feishu registrations from SQLite: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'feishu:%'"`
5. Uninstall: `npm uninstall @larksuiteoapi/node-sdk`
6. Rebuild: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `npm run build && systemctl --user restart nanoclaw` (Linux)
