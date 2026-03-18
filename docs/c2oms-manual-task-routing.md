# C2OMS ManualTask Routing

用于控制 c2oms ManualTask webhook 在 nanoclaw 内部投递到哪个群，而不是默认广播到所有主控群。

## 配置位置

默认读取：

```bash
~/.config/nanoclaw/manual-task-routing.json
```

也可以通过环境变量覆盖：

```bash
export MANUAL_TASK_ROUTING_CONFIG_PATH=/absolute/path/to/manual-task-routing.json
```

仓库里也提供了一份可直接复制的示例：

[config-examples/manual-task-routing.json](../config-examples/manual-task-routing.json)

## 配置格式

```json
{
  "defaultTarget": "main-groups",
  "rules": [
    {
      "name": "tenant-1-approval",
      "tenantIds": ["1"],
      "taskTypes": ["APPROVAL"],
      "targetFolders": ["ops-review"]
    },
    {
      "name": "completed-events-to-audit-room",
      "eventTypes": ["oms:execution:ManualTask:Status:Completed"],
      "targetJids": ["audit-room@g.us"]
    }
  ]
}
```

最快的起步方式：

```bash
mkdir -p ~/.config/nanoclaw
cp config-examples/manual-task-routing.json ~/.config/nanoclaw/manual-task-routing.json
```

## 字段说明

1. defaultTarget
可选值：main-groups、drop。
未命中任何规则时，main-groups 会回落到主控群，drop 会直接丢弃。

2. tenantIds
按租户匹配，使用 webhook payload 里的 variables.tenantId。

3. eventTypes
按事件类型匹配，例如 oms:execution:ManualTask:Lifecycle:Created。

4. taskTypes
按任务类型匹配，例如 APPROVAL、REVIEW、CONFIRMATION。

5. targetFolders
按已注册群的 folder 匹配，适合稳定业务群路由。

6. targetJids
按具体群 JID 直接投递。

## 匹配规则

1. 单条规则内是 AND 关系。
2. 多条规则之间是 OR 关系，命中的目标会合并去重。
3. 只要命中规则，就不会再自动广播到主控群。

## 推荐做法

1. 优先用 targetFolders，而不是直接写 targetJids。
2. 先按 tenantIds + taskTypes 做粗路由，避免一开始规则过细。
3. 完成类事件单独投到审计群，创建类事件投到处理群。