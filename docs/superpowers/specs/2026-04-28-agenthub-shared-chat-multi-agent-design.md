# AgentHub 共享聊天式多 Agent 设计

## 目标

AgentHub 需要支持在同一个 workspace 下同时运行多个不同 Agent，并把 HMI 中间区域从“单个选中终端”改成“共享聊天时间线”。在这个视角里，用户、Codex、Claude、Gemini、PowerShell 都是同一个对话现场里的参与者。

第一版只支持每个 Agent profile 最多一个在线会话。不支持多个 Codex 实例、不支持 Agent 自动互相转发、不支持 git worktree 隔离。

## 用户体验

HMI 布局调整为：

- 左侧：Agent 名单，显示 profile 名称、运行状态、启动/停止控制。
- 中间：共享聊天时间线，显示所有用户消息和 Agent 输出。
- 中间底部：统一输入框。
- 右侧：任务看板和历史 runs。

输入通过可选的 `@agent` 前缀定向路由：

- `@codex implement the parser`：把 `implement the parser` 发给 Codex。
- `@claude split this requirement`：发给 Claude。
- `@gemini review current diff`：发给 Gemini。
- `@powershell dir`：发给 PowerShell。
- 不带 `@agent` 前缀时，消息发给默认活跃 Agent。初始默认 Agent 是 Codex。

向某个 Agent 发送消息时，不切换中间视图。中间区域始终保持全局共享聊天时间线。

## 会话模型

把 `MainWindow` 中当前的单会话字段替换成按 profile id 索引的 session map：

```python
@dataclass
class AgentSessionState:
    profile: AgentProfile
    session: InteractivePtySession | None
    output_buffer: OutputBuffer
    log_writer: RunLogWriter | None
    run_index_store: RunIndexStore | None
    run_id: str | None
    status: AgentSessionStatus
```

第一版同一个 profile 只允许一个会话。只要有任何会话仍然存活，就禁用 workspace 切换，避免 cwd 和日志归属混乱。

## 聊天时间线

聊天时间线存储的是展示事件，不是原始终端流：

```python
@dataclass
class ChatMessage:
    sender_id: str
    sender_name: str
    text: str
    kind: ChatMessageKind
    timestamp: str
```

用户发送产生 `kind=user` 消息。Agent 输出产生 `kind=agent` 消息。系统错误、未知 `@agent`、向未启动 Agent 发送消息等情况产生 `kind=system` 消息。

PTY 的 raw / clean 日志仍然按每个 run 独立保存。聊天时间线只是 HMI 对实时输出的一层视图，不是 canonical log。

## 输出处理

定时器需要 drain 所有在线 session。每个 session 保留独立的 `OutputBuffer` 和 run log writer。某个 session 出现新的 screen snapshot 时，HMI 在共享聊天时间线中追加或更新该 Agent 的消息块。

第一版可以按每个 drain tick 追加一条 Agent 消息，不要求完美解析 Codex / Claude / Gemini 的 TUI 输出边界。

## 错误处理

- 未知路由，例如 `@reviewer`，显示系统消息，不发送。
- 向离线 Agent 发送消息时，显示系统消息，不自动启动。
- Agent 启动失败时，写入 run index，并显示系统消息。
- Agent 进程退出后，状态变为 exited，左侧 Agent 名单同步更新。

## 测试要求

测试需要覆盖：

- 多个不同 profile 可以同时启动，并被独立追踪。
- drain loop 会读取所有在线 session，并追加带 Agent 标签的聊天消息。
- `@agent` 解析可以正确路由输入。
- 未知或离线 `@agent` 目标会产生系统消息。
- 任意 session 存活时，workspace 控件被禁用。
- 既有 run logging、run index、任务看板和历史 runs UI 继续工作。

## 非目标

- 同一个 Agent profile 多开。
- 角色提示编辑。
- Agent 自主互相转发。
- 写入锁或 git worktree 隔离。
- 超出功能性共享时间线的富文本聊天渲染。
