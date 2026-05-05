# AgentHub 跨 CLI Team Runtime

AgentHub 的 Team Runtime 目标是让 Claude、Codex、Gemini、PowerShell 等不同 CLI 通过同一套中立协议协作。CLI 不需要直接读取聊天区；AgentHub 负责接收 hook、解析命令、写入 mailbox，并把消息投递到目标 CLI 的 PTY。

## 当前能力

- 每个启动的 CLI 会获得默认环境变量：
  - `AGENTHUB_HOOK_URL`
  - `AGENTHUB_HOOK_TOKEN`
  - `AGENTHUB_PROFILE_ID`
  - `AGENTHUB_SESSION_ID`
  - `AGENTHUB_RUN_ID`
  - `AGENTHUB_WORKSPACE`
  - `AGENTHUB_TEAM_ID=default`
- hook 返回的结果会进入中央事件流。
- Agent 输出里的 `<agenthub>{...}</agenthub>` 命令会被 AgentHub 解析。
- 团队消息写入 `<workspace>/.agenthub/teams/<teamId>/mailbox.jsonl`。
- 默认团队配置写入 `<workspace>/.agenthub/teams/<teamId>/config.json`。

## 支持的命令

发送消息给另一个 CLI：

```text
<agenthub>{"action":"send_message","to":"gemini","message":"请审查这个方案","team_id":"default","task_id":"T-001"}</agenthub>
```

认领任务：

```text
<agenthub>{"action":"claim_task","task_id":"T-001","team_id":"default"}</agenthub>
```

完成任务：

```text
<agenthub>{"action":"complete_task","task_id":"T-001","summary":"实现完成，测试通过","team_id":"default"}</agenthub>
```

## 运行方式

1. 在同一工作区启动 Claude、Codex、Gemini 等 profile。
2. 让某个 Agent 在最终回复里输出 `<agenthub>{...}</agenthub>` 命令。
3. 对应 CLI 的 hook 脚本把最终回复 POST 回 AgentHub。
4. AgentHub 解析命令并投递到目标 CLI。

## 当前限制

- 现在是默认 `default` team，暂未做 UI 上的多 team 管理。
- mailbox 已落盘，但界面暂未单独展示 mailbox。
- CLI 仍然不会主动监听聊天区，推进依赖 hook 返回和 AgentHub 投递。
- 任务认领/完成会同步任务看板，但任务依赖和文件级锁还未接入 Team Runtime。
