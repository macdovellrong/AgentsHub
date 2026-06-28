# Native Windows Terminal Host Workspace/Session Update

## 本次增量

- WPF App 从单路径输入升级为 workspace 列表。
- workspace 列表持久化到 `%LOCALAPPDATA%\AgentHub\Native\workspaces.json`。
- 支持添加、删除、选择 workspace。
- 启动 Agent 时会自动把当前 workspace 写入列表。
- 支持 Stop selected，会通过 `AgentInputRouter.StopAsync()` 停止并移除当前 session。
- 停止流程会先发送 Ctrl+C，再关闭 stdin，随后 kill 进程树并断开 terminal control。

## 验证重点

- Native app 启动后能加载已保存 workspace。
- 添加同一路径不会重复出现。
- 选中 workspace 后启动 Codex/Claude/Gemini 使用该目录。
- Stop selected 后 session 从列表移除，输入路由不再向该 session 写入。
