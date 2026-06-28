# Native Windows Terminal Host Routing Update

## 本次增量

- 新增 `AgentSessionRegistry`，按 workspace/profile 记录活跃 session。
- 新增 `AgentMessageRouter`，可以把消息发送到当前 workspace 下某个 profile 的最新 session。
- WPF App 启动 session 时会注册到 registry，停止 session 时会移除。
- 输入栏新增目标下拉框：
  - `Selected session`：直接发送到当前选中的 session。
  - `codex`、`claude`、`gemini`、`powershell`：发送到当前 workspace 下对应 profile 的最新 session。

## 意义

这一步把“可以手动写入某个终端”推进到“AgentHub 可以按 workspace/profile 路由输入”。后续多 Agent 协作、hook 回传后的自动转发、任务编排都可以复用这个 Core 路由入口。
