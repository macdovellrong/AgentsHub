# AgentHub 多工作区与统一聊天第一版设计

## 目标

第一版把 AgentHub 从“一个当前项目目录”扩展为“多个项目工作区的控制台”，并把中央区域明确为聊天/结果流，而不是终端输出容器。用户可以在左侧切换不同项目目录，在当前工作区内通过 `@profile` 向在线 Agent 发送消息，并把某个 Agent 的最近终端输出手动保存为中央结果，再转发给其他 Agent。

## 范围

- 支持添加、持久化、切换多个工作区。
- 切换工作区只切换 UI 上下文，不停止其他工作区内的在线 session。
- Agent 启动、runs、tasks、events、forwards 继续绑定到具体 `workspacePath`。
- 中央聊天区只展示结构化事件：用户消息、session 状态、转发、任务、错误、手动保存的 Agent 结果。
- 完整 PTY 输出仍只在对应 xterm 终端和 run log 中展示。

不在本版实现独立弹窗终端、自动结果提取、自动 Agent-to-Agent 调度、跨工作区批量操作。

## 工作区模型

主进程新增 `WorkspaceStore`，配置保存到 Electron `userData/workspaces.json`：

```json
{
  "activeWorkspacePath": "V:\\AgentGroup",
  "workspaces": [
    { "path": "V:\\AgentGroup", "name": "AgentGroup", "lastOpenedAt": "2026-04-29T00:00:00.000Z" }
  ]
}
```

`workspace:select` 负责打开目录选择器并加入工作区列表。新增 `workspaces:list` 和 `workspace:activate`。原有 `workspacePath` 参数继续作为所有业务 IPC 的显式上下文。

## UI 布局

左侧最上方增加“工作区”区域，显示路径名、完整路径、当前在线 session 数量。点击某个工作区后刷新当前工作区的 events/runs/tasks/forwards。Profile 列表只显示当前工作区的在线状态，右侧终端停靠区也只展示当前工作区的 session。

顶部保留当前工作区路径和刷新按钮。“打开工作区”改为向列表添加或激活目录。

## 统一聊天与转发

中央 timeline 继续读取 `.agenthub/events.jsonl`。输入框仍支持 `@codex`、`@claude`、`@gemini` 等路由。每条可读事件提供“转发”操作，把消息内容填入转发编辑器，用户选择目标 Agent 后可入队或立即发送。

终端区新增“保存为结果”和“转发最近输出”。前者把当前选中 session 的最近清洗文本写入 `agent_output` 事件；后者把该文本带入转发编辑器。这样中央区只接收人为确认后的结果，避免被动态 CLI 输出刷屏。

## 错误处理

- 添加工作区取消时不改变当前状态。
- 切换工作区失败时显示错误 banner，并保留当前工作区。
- 向离线 Agent 发送中央消息或转发时沿用现有错误/blocked 事件。
- 最近终端输出为空时，保存和转发按钮禁用。

## 测试

- `WorkspaceStore` 覆盖默认工作区初始化、添加去重、激活持久化、列表排序。
- `dashboard-helpers` 覆盖工作区 session 计数、当前工作区过滤、终端预览清洗和截断。
- 继续运行 `npm run typecheck`、`npm test`、`npm run build`。
