# AgentHub 文件式协商上下文设计

## 背景

当前双人协商通过 PTY 把上一轮 Agent 的大段文本直接粘贴给下一轮 Agent。这个方式可以跑通流程，但在 Windows ConPTY + TUI CLI 下不够稳定：大段 bracketed paste 容易触发提交时序问题，中央聊天区也会被长文本污染。下一版改为“文件承载完整上下文，PTY 只传短指令”。

## 目标

- 每轮 Agent 输出都独立落盘，便于追溯和审计。
- 下一轮 Agent 默认只接收短 prompt、文件路径和摘要，减少 PTY 粘贴体积。
- Agent 可以读取完整历史，但默认优先读取 `brief.md`、`memory.md` 和上一轮 turn 文件。
- 中央聊天区只显示摘要、状态和文件路径，不显示完整协商正文。

## 非目标

- 第一版不做向量记忆、RAG 或自动语义检索。
- 第一版不把协商文件自动提交到 Git。
- 第一版不把最终方案自动同步到 `docs/`，只保留后续“导出最终方案”入口。

## 文件结构

每个协商会话创建一个目录：

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

`brief.md` 保存用户原始议题，创建后不自动修改。

`memory.md` 保存当前共识、关键约束、未解决问题和最新方案摘要。第一版可以由当前 Agent 根据 prompt 主动更新；后续可替换为 AgentHub 内置 summarizer。

`turns/*.md` 保存每轮完整输出。文件名使用四位序号加 profileId，避免不同 Agent 覆盖彼此内容。

`state.json` 保存当前轮次、参与者、当前方案版本、最后 artifact 路径和会话状态，供 AgentHub 恢复流程使用。

## Memory 更新规则

第一版不引入内置总结模型。每轮 prompt 都要求当前 Agent 在写入自己的 turn 文件后，同步更新 `memory.md`。更新内容只保留当前共识、关键约束、未解决问题、最新方案版本和下一轮关注点，不复制完整历史。

AgentHub 只校验 `memory.md` 是否存在，不判断内容质量。后续版本再增加内置 summarizer 或人工编辑入口。

## 协商流程

1. 用户创建双人协商，选择 Claude 和 Codex，输入议题。
2. AgentHub 创建 conversation 目录，写入 `brief.md`、空的 `memory.md` 和 `state.json`。
3. AgentHub 给第一位 Agent 发送短 prompt，要求它阅读 `brief.md`，把完整结果写入 `turns/0001-claude.md`。
4. Agent 最后输出一行 `<agenthub>` 控制指令，包含 `action`、`proposal_version`、`artifact_path` 和 `summary`。
5. AgentHub 校验 `artifact_path` 是否存在，再把短 prompt 发给下一位 Agent。
6. 下一位 Agent 默认阅读 `brief.md`、`memory.md`、上一轮 turn 文件；如需追溯，可自行查看 `turns/` 下全部历史。
7. 每轮重复，直到双方对同一 `proposal_version` 输出 `accept`，或达到最大轮次后暂停。

## 控制指令

继续协商：

```json
{"action":"continue","proposal_version":2,"artifact_path":".agenthub/conversations/<id>/turns/0002-codex.md","summary":"一句话摘要"}
```

认可方案：

```json
{"action":"accept","proposal_version":2,"artifact_path":".agenthub/conversations/<id>/turns/0004-codex.md","summary":"认可原因"}
```

`artifact_path` 必须指向当前 workspace 内的 `.agenthub/conversations/<conversationId>/turns/` 文件。AgentHub 需要拒绝绝对路径、父目录跳转和不存在的文件。

## Prompt 策略

发送给 Agent 的 prompt 保持短文本：

```text
这是 AgentHub 双人协商。

请优先阅读：
1. .agenthub/conversations/<id>/brief.md
2. .agenthub/conversations/<id>/memory.md
3. .agenthub/conversations/<id>/turns/0001-claude.md

请把完整输出写入：
.agenthub/conversations/<id>/turns/0002-codex.md

最后只输出一行 <agenthub> 控制指令。
```

## UI 行为

中央聊天区显示事件摘要：

- `Claude 已写入 turns/0001-claude.md`
- `Codex 已审查，摘要：...`
- `双方已接受 proposal_version=2`

完整正文通过“打开文件”或历史 turn 列表查看，不直接灌入聊天气泡。

## 错误处理

- Agent 没有输出 `<agenthub>`：标记 `parse_error`，会话暂停。
- `artifact_path` 不存在：标记 `waiting_artifact` 并暂停会话，允许用户手动修复后继续。
- 目标 Agent 离线：写入 `waiting_session` 事件，不丢失当前轮次。
- 写文件越界：拒绝路径并标记安全错误。

## 测试计划

- Conversation artifact store：创建目录、写 `brief.md`、分配 turn 文件名、校验 artifact 路径。
- Orchestrator：启动协商时只发送短 prompt；收到 `continue` 后校验 artifact 并发给下一位 Agent。
- Hook receiver：保留 `conversationId` 回填逻辑，支持从 `<agenthub>` 中读取 `artifact_path`。
- Renderer：聊天区只展示摘要和路径，不渲染完整 turn 文件。
