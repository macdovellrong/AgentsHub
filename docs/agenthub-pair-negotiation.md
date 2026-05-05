# AgentHub 双人协商功能设计总结

## 背景与目标

双人协商用于让两个 CLI Agent 围绕同一个议题交替产出、审查和修订，直到双方对同一版方案达成认可。当前默认组合是 Claude 先提出方案，Codex 负责审查或修订，后续继续轮换。

早期方案曾尝试把上一轮完整文本直接粘贴给下一位 Agent。这个方式在 Windows ConPTY 和 TUI CLI 中不稳定：大段粘贴容易丢回车、污染中央聊天区，也会让每一轮 prompt 越来越长。因此当前设计改为“文件承载完整上下文，PTY 只传短指令”。

## 核心开发思路

核心原则是把 AgentHub 当作编排器，而不是另一个直接参与讨论的模型。AgentHub 负责创建会话、分配文件路径、投递短 prompt、校验 Agent 回传的控制指令，并把状态写入事件流。完整方案正文由 Agent 自己写入 Markdown 文件，AgentHub 只在聊天区展示摘要和路径。

这样做的收益：

- 减少 PTY 粘贴体积，降低不同 CLI 对回车和 bracketed paste 处理差异的影响。
- 每一轮都有独立 Markdown 文件，方便追溯、审计和人工介入。
- 下一轮 Agent 可以读取完整历史，但默认只需要读取议题、记忆和上一轮输出。
- 中央聊天区保持轻量，只展示协商结果摘要、转发状态和错误。

## 当前架构

主要模块如下：

- `ConversationOrchestrator`：双人协商状态机，负责启动会话、接收 Agent 输出、解析 `<agenthub>` 指令、决定下一轮投递对象。
- `ConversationStore`：持久化 conversation 元数据，包括 mode、participants、status、currentStep、maxSteps。
- `ConversationArtifactStore`：创建和校验协商文件，包括 `brief.md`、`memory.md`、`state.json` 和 `turns/*.md`。
- `agent-command-parser`：解析 Agent 输出中的 `<agenthub>{...}</agenthub>` JSON 控制块。
- `pair-prompt-templates`：读取全局 prompt 模板并做变量替换。
- `EventStore`：记录聊天区和编排事件，例如 `agent_output`、`agent_forward`、`orchestration_step`。
- Electron renderer：提供“双人协商”按钮、聊天区摘要展示和会话管理入口。

## 文件结构

每次双人协商会在当前工作区创建独立目录：

```text
<workspace>/.agenthub/conversations/<conversationId>/
  brief.md
  memory.md
  state.json
  turns/
    0001-claude.md
    0002-codex.md
    0003-claude.md
```

文件职责：

- `brief.md`：保存用户输入的原始议题、参与者和最大步数。
- `memory.md`：保存当前共识、约束、未解决问题和下一轮关注点，由 Agent 按 prompt 主动维护。
- `state.json`：保存会话恢复所需的基础状态。
- `turns/*.md`：保存每轮 Agent 的完整输出，文件名使用四位序号加 profile id。

## Prompt 策略

双人协商 prompt 当前只从 AgentHub 全局目录读取：

```text
desktop/prompts/pair-initial.md
desktop/prompts/pair-turn.md
desktop/prompts/pair-acceptance.md
```

工作区内不再自动创建 `.agenthub/prompts`，即使残留旧模板也不会覆盖全局模板。这样可以避免某个项目的旧 prompt 阻塞 AgentHub 后续升级。

三类 prompt 的职责：

- `pair-initial.md`：给第一位 Agent，要求读取 `brief.md`，写入第一轮 `turns/0001-*.md`，并输出控制指令。
- `pair-turn.md`：给下一位 Agent，要求读取 `brief.md`、`memory.md` 和上一轮 `turns/*.md`，再写入自己的新 turn 文件。
- `pair-acceptance.md`：当一方已经接受某版方案时，让另一方确认或继续修订。

## 控制协议

Agent 每轮最后必须输出一行 `<agenthub>` 控制指令。继续协商：

```text
<agenthub>{"action":"continue","proposal_version":2,"artifact_path":".agenthub/conversations/<id>/turns/0002-codex.md","summary":"一句话摘要"}</agenthub>
```

认可方案：

```text
<agenthub>{"action":"accept","proposal_version":2,"artifact_path":".agenthub/conversations/<id>/turns/0004-codex.md","summary":"认可原因"}</agenthub>
```

`artifact_path` 必须指向当前 conversation 的 `turns/` 目录下的 Markdown 文件。AgentHub 会拒绝绝对路径、父目录跳转和不存在的文件。

## 执行流程

1. 用户在中央聊天输入议题，点击“双人协商”。
2. Renderer 选择 Claude 类 profile 和 Codex 类 profile，调用 `startPairNegotiationConversation`。
3. 主进程创建 `pair_negotiation` conversation，默认最大轮数为 3，最大步数为 `participants.length * maxRounds`。
4. `ConversationArtifactStore` 初始化协商目录和基础文件。
5. AgentHub 渲染 `pair-initial.md`，把短 prompt 发给第一位 Agent。
6. Agent 写入自己的 turn 文件，并通过 hook 或输出事件返回 `<agenthub>` 指令。
7. Orchestrator 校验当前说话人、解析指令、校验 `artifact_path`。
8. 如果是 `continue`，AgentHub 渲染 `pair-turn.md` 并投递给另一位 Agent。
9. 如果是 `accept`，AgentHub 记录该 profile 对 `proposal_version` 的认可；双方都认可同一版本时，会话完成。
10. 达到最大步数但仍未完成时，会话暂停，等待人工处理。

## 兼容与失败处理

当前实现保留了旧格式兼容：如果 Agent 只返回 `message` 而没有 `artifact_path`，AgentHub 会优先检查当前轮次预期的 turn 文件是否存在；如果不存在，会把可见输出落成当前轮次 Markdown，再继续文件流转。

主要失败场景：

- 没有在线的首位 Agent：会话标记为 `failed`。
- 下一位 Agent 离线：写入 `agent_forward` 失败事件，并把会话标记为 `failed`。
- `<agenthub>` JSON 无法解析：写入 `parse_error`，不会自动推进。
- `artifact_path` 不存在或越界：会话标记为 `paused`，事件状态为 `waiting_artifact`。
- 达到最大步数：会话标记为 `paused`，用户可查看 turn 文件后决定下一步。

## UI 表现

中央聊天区只显示摘要信息，不显示完整协商正文。对于文件式输出，聊天区应展示类似：

```text
Claude 已写入 .agenthub/conversations/<id>/turns/0001-claude.md：方案摘要
```

完整内容通过文件系统查看。这样聊天区保持可读，Agent 的长方案仍然完整保留。

## 后续可扩展方向

- 支持多 Agent 轮转：把固定的“另一位 Agent”改成参与者队列即可扩展到 Claude、Codex、Gemini 多方讨论。
- 内置协调 Agent：由一个 API 模型读取 `memory.md` 和事件流，决定下一位发言者和停止条件。
- 最终方案导出：双方 accept 后，把最终 turn 文件复制或整理到 `docs/`。
- 记忆质量校验：增加 summarizer 或 schema 检查，避免 `memory.md` 被 Agent 写乱。
- UI 文件入口：在聊天摘要旁增加“打开 turn 文件”和“打开 conversation 目录”按钮。
