# AgentHub Conversation Orchestrator 设计

## 目标

AgentHub 需要从“用户手动 `@agent` 转发消息”升级为“事件驱动的多 Agent 协作系统”。第一版目标是支持两类工作流：

- Claude 主管模式：用户把功能清单交给 Claude 管理，Claude 根据结果持续派发任务给 Codex / Gemini。
- 多 Agent 讨论模式：Claude、Codex、Gemini 在同一个协作会话中看到彼此消息，并按规则讨论方案。

聊天区域仍然是展示层；真正的协作数据源是后台事件流和 conversation state。Agent 不直接读取 UI，而是由 AgentHub 把新事件整理成 prompt 投递给对应 CLI。

## 非目标

- 不让 Agent 任意轮询或读取 Electron DOM。
- 第一版不自动启动离线 Agent，只向在线 session 投递。
- 第一版不做完全自然语言意图识别，只解析显式结构化协议。
- 不允许无限循环式 Agent 互相触发，所有自动协作必须有步数或轮数上限。

## 核心概念

### Conversation

一次主管任务或一次多人讨论都是一个 conversation。

建议新增字段：

- `conversationId`：协作会话 ID。
- `mode`：`manager` 或 `roundtable`。
- `status`：`running` / `paused` / `completed` / `failed`。
- `supervisorProfileId`：主管模式下通常是 Claude。
- `participantProfileIds`：参与 Agent 列表。
- `maxSteps`：最大自动推进次数。
- `currentStep`：当前自动推进次数。
- `createdAt` / `updatedAt`。

### Conversation Message

现有 `AgentHubEvent` 可以继续作为展示事件，但需要扩展协作字段：

- `conversationId`：归属 conversation。
- `taskId`：Claude 派发的任务编号，例如 `T-001`。
- `parentEventId`：回复或 observation 关联的上游消息。
- `targetProfileId` / `targetProfileIds`：投递目标。
- `deliveryStatus`：`pending` / `sent` / `observed` / `failed`。
- `metadata.agenthubCommand`：保存解析出的结构化指令。

### Agent Cursor

每个 conversation 中，每个 Agent 都维护一个 cursor，表示它已经收到或处理到哪条事件。这样可以避免 AgentHub 重复把同一条结果投递给 Claude。

## 结构化指令协议

Claude 的自然语言回复只进入聊天区，不触发自动动作。只有包含 `<agenthub>...</agenthub>` 的 JSON 块才会被执行。

示例：

```text
我会先让 Codex 实现，再让 Gemini 审查。

<agenthub>
{
  "action": "send",
  "target": "codex",
  "task_id": "T-001",
  "message": "实现功能清单中的工作区切换保护，完成后返回修改文件和测试结果。"
}
</agenthub>
```

第一版支持的 action：

- `send`：向一个 Agent 发送任务。
- `ask_user`：暂停自动推进，向用户提问。
- `done`：结束 conversation，并展示总结。

后续可扩展：

- `send_many`：并行发送给多个 Agent。
- `wait`：显式等待某个任务结果。
- `summarize`：要求主管汇总当前 conversation。

## Claude 主管模式流程

1. 用户在聊天区输入功能清单，点击“交给 Claude 管理”。
2. AgentHub 创建 `conversation`，写入用户清单事件。
3. AgentHub 生成主管 prompt，发送给 Claude。
4. Claude 输出自然语言说明和 `<agenthub>` JSON 指令。
5. AgentHub 解析指令，校验目标 Agent 是否在线、是否超过步数限制。
6. 对 `send` 指令，AgentHub 写入 `agent_forward` 事件，并把任务投递给 Codex 或 Gemini。
7. Codex / Gemini 完成后通过 hook 写入 `agent_output`。
8. AgentHub 根据 `conversationId` 和 `taskId` 生成 observation prompt，投递给 Claude。
9. Claude 决定继续派发、询问用户或结束。

主管 observation prompt 应包含：

- 新结果来自哪个 Agent。
- 关联 task id。
- 结果摘要和完整消息。
- 当前 conversation 已执行步数。
- 可用 action 协议。

## 多 Agent 讨论模式流程

1. 用户创建讨论主题，选择参与者，例如 Claude / Codex / Gemini。
2. AgentHub 创建 `roundtable` conversation。
3. 第一轮把讨论主题投递给所有参与者，或按固定顺序投递给第一个发言者。
4. 每个 Agent 的 hook 结果进入 conversation。
5. AgentHub 按轮次和顺序把上一位 Agent 的观点摘要投递给下一位。
6. 达到最大轮数后，主管 Agent 或用户指定的主持 Agent 生成总结。

第一版建议使用固定顺序：

```text
Claude -> Codex -> Gemini -> Claude 总结
```

默认最多 2 轮。用户可以手动暂停、继续、停止。

## 模块设计

### ConversationStore

负责持久化 conversation 状态。

路径建议：

- `<workspace>/.agenthub/conversations/conversations.jsonl`
- `<workspace>/.agenthub/conversations/<conversation_id>/state.json`

### AgentCommandParser

负责从 Agent 输出中解析 `<agenthub>` JSON。解析失败只写错误事件，不执行任何动作。

### ConversationOrchestrator

核心状态机。它监听 `agent_output` 和用户动作，根据 conversation state 决定是否投递下一条 prompt。

### ConversationDelivery

封装“把一条协作消息投递到在线 PTY session”的细节。它复用现有 `PtySessionManager.write()` 和 profile 查找逻辑，并沿用 Gemini 使用 `\r\n` 的提交规则。

### Renderer UI

第一版只做必要控制：

- 聊天输入旁增加“交给 Claude 管理”按钮。
- 增加“新建讨论”入口。
- 每条 conversation 显示状态、步数、参与者。
- 提供暂停、继续、停止按钮。
- 聊天气泡显示 `conversationId` / `taskId` 标签。

## 安全与控制

- 每个 conversation 必须有 `maxSteps`，默认 12。
- 每个讨论模式必须有 `maxRounds`，默认 2。
- 目标 Agent 离线时，不自动启动，只写 `waiting_session` 或 `failed_delivery`。
- 结构化指令必须通过 JSON schema 校验。
- 自动投递的消息需要写入事件流，用户可追踪每一步。
- 用户可以随时暂停或停止 conversation。
- 第一版不允许 Agent 指令执行 shell 命令，只允许向其他 Agent 发送文本。

## 测试策略

- `AgentCommandParser`：有效 JSON、多个 JSON 块、非法 JSON、未知 action。
- `ConversationStore`：创建、更新、列出、恢复状态。
- `ConversationOrchestrator`：Claude `send` 指令能生成转发；Codex/Gemini 结果能生成 Claude observation；达到 `maxSteps` 后停止。
- `ConversationDelivery`：离线目标不投递；Gemini 使用 `\r\n`；非 Gemini 使用 `\r`。
- Renderer：按钮触发 IPC；conversation 状态展示；暂停/停止按钮可用。

## 第一版开发任务清单

1. 扩展事件模型，增加 conversation 关联字段。
2. 新增 `ConversationStore`。
3. 新增 `AgentCommandParser`。
4. 新增 `ConversationOrchestrator` 主管模式。
5. 把 hook `agent_output` 接入 orchestrator observation。
6. 新增 Claude 管理按钮和 conversation 状态 UI。
7. 增加暂停、继续、停止。
8. 新增 roundtable 讨论模式。
9. 做端到端 smoke：Claude 派发给 Codex，Codex 完成后 Claude 收到 observation 并继续。

