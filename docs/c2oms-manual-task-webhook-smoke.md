# C2OMS ManualTask Webhook Smoke

用于验证 c2oms-backend -> nanoclaw 主控群 的 ManualTask webhook 推送链路。

## 前提

1. nanoclaw 已启动，且至少存在一个主控群。
2. nanoclaw 已配置：

```bash
export MANUAL_TASK_WEBHOOK_SECRET=your-shared-secret
export MANUAL_TASK_WEBHOOK_PORT=32111
export MANUAL_TASK_WEBHOOK_PATH=/hooks/c2oms/manual-tasks
export MANUAL_TASK_ROUTING_CONFIG_PATH=~/.config/nanoclaw/manual-task-routing.json
```

3. c2oms-backend 本地环境使用相同密钥：

```bash
export MANUAL_TASK_PUSH_ENABLED=true
export MANUAL_TASK_PUSH_WEBHOOK_URL=http://127.0.0.1:32111/hooks/c2oms/manual-tasks
export MANUAL_TASK_PUSH_WEBHOOK_SECRET=your-shared-secret
```

## 最短验证

在 c2oms-backend 仓库执行：

```bash
npm run smoke:manual-task-push
```

成功时会返回 HTTP 200，且 nanoclaw 的所有主控群会收到一条形如下面的消息：

```text
OMS ManualTask 推送
标题: 本地联调审批任务
事件: oms:execution:ManualTask:Lifecycle:Created
任务: mrt_smoke_001
状态: PENDING

这是一条从 c2oms-backend 发往 nanoclaw 的 ManualTask webhook 联调消息。
```

如果你已经配置了路由规则，消息会优先发往命中的业务群，而不是主控群。路由规则说明见：

[docs/c2oms-manual-task-routing.md](./c2oms-manual-task-routing.md)

## 常用覆盖参数

```bash
SMOKE_EVENT_TYPE=oms:execution:ManualTask:Status:Completed \
SMOKE_TASK_STATE=COMPLETED \
SMOKE_TASK_TITLE='订单审批已完成' \
SMOKE_CONTENT='审批通过，等待后续处理。' \
npm run smoke:manual-task-push
```

## 失败排查

1. 返回 401：检查两边的 MANUAL_TASK_PUSH_WEBHOOK_SECRET / MANUAL_TASK_WEBHOOK_SECRET 是否一致。
2. 返回 404：检查 nanoclaw 的端口或路径是否和 webhook URL 一致。
3. 返回 200 但群里没消息：确认已注册主控群，或者检查路由规则是否把消息投到了别的业务群。
4. c2oms 真正事件没有推送：确认 c2oms-backend 设置了 MANUAL_TASK_PUSH_ENABLED=true。
5. 只想验证业务群路由：先复制 [config-examples/manual-task-routing.json](../config-examples/manual-task-routing.json)，再把 targetFolders 改成你本地实际 group folder。