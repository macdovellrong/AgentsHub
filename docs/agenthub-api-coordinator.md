# AgentHub 内置 API 协调 Agent 方案草案

## 背景

AgentHub 当前已经支持固定编排、共享聊天、hook 回传和跨 CLI 消息转发。后续如果要让 Claude、Codex、Gemini 在一个任务中更自然地协作，需要决定编排逻辑是继续由程序硬编码，还是引入一个内置的 API Agent 来做流程判断。

## 结论

推荐采用混合架构：**程序固定流程负责硬规则，内置 API Agent 负责软决策**。

AgentHub 本体继续掌握执行权，包括 Agent 在线状态、消息投递、最大步数、暂停/恢复、日志、任务状态、写入锁、失败处理和用户确认。内置 API Agent 只根据当前上下文判断下一步应该让谁做什么，并输出结构化动作。

不建议把内置 API Agent 做成完全接管系统的总控。它不能直接操作 PTY，不能直接执行 shell，不能直接写事件流，也不能绕过权限和状态校验。

## 不建议纯固定流程的原因

固定流程适合第一版，例如：

```text
Claude 规划 -> Codex 实现 -> Gemini 审查 -> Claude 总结
```

但任务复杂后会遇到限制：

- 有些任务不需要 Gemini 审查。
- 有些任务需要 Codex 连续修改多轮。
- Gemini 可能提出问题，需要 Claude 重新决策。
- 未来可能需要多个 Codex profile 并行处理不同文件。
- 用户临时插话后，固定状态机不容易自然接住。

如果继续把这些判断全部写死在程序里，状态机会越来越复杂，扩展成本也会变高。

## 不建议完全交给 API Agent 的原因

API Agent 有不确定性，不能成为最终执行者：

- 可能误判下一步。
- 可能产生循环转发。
- 可能把不该发送的内容投递给 CLI。
- 会增加成本和延迟。
- 本地项目内容可能涉及隐私。

因此 API Agent 应该只输出建议动作，AgentHub 程序负责验证和执行。

## 推荐数据流

```text
用户输入 / CLI hook
    ↓
AgentHub Event Store
    ↓
Coordinator Context Builder
    ↓
内置 API Coordinator Agent
    ↓
结构化 JSON 动作
    ↓
Action Validator
    ↓
AgentHub Executor
    ↓
Claude / Codex / Gemini PTY
```

## API Coordinator 输出示例

```json
{
  "action": "send_message",
  "to": "codex",
  "task_id": "T-001",
  "message": "请实现任务 T-001，完成后总结修改文件和测试结果。"
}
```

AgentHub 收到后必须校验：

- 目标 Agent 是否在线。
- 是否超过最大步骤或最大轮数。
- 是否允许自动投递。
- 是否需要用户确认。
- 是否重复发送过同一任务。
- 是否需要写入事件流、任务看板和运行日志。
- 是否需要暂停等待用户。

## 建议的编排模式

后续可以保留三种模式：

1. **手动模式**：用户自己通过聊天区 `@codex`、`@claude`、`@gemini` 发送消息。
2. **固定流程模式**：适合稳定流水线，例如 `Claude -> Codex -> Gemini -> Claude`。
3. **智能主管模式**：AgentHub 内置 API Coordinator，根据任务、聊天历史和 Agent 返回结果动态决定下一步。

## 实现建议

当前不需要推翻已有实现。建议先把现有固定编排抽象成 `OrchestrationPolicy`，后续新增 `ApiCoordinatorPolicy`：

- `FixedPolicy`：复用当前固定流程。
- `RoundtablePolicy`：复用当前多 Agent 轮流讨论。
- `ApiCoordinatorPolicy`：调用内置 API Agent 生成下一步动作。

所有 policy 都只返回结构化动作，由统一的 validator 和 executor 执行。这样可以保证 UI、日志、hook、任务看板和安全控制保持一致。

## 当前建议

短期继续修好现有固定流程和 hook 链路。等 Claude、Codex、Gemini 的消息投递和结果回传稳定后，再增加内置 API Coordinator。这样风险最低，也不会让系统过早变成不可控的黑盒。
