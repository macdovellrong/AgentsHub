# AgentHub Task Plan Manager Design

## 实现状态

已完成第一版落地：`TaskPlanStore`、`TaskPlanService`、plan-level `<agenthub>` 命令、hook `planId` 归属、IPC/preload API 和 React “任务计划”面板都已接入。UI 中可见的旧“受控编排”和“任务看板”入口已替换为“任务计划”；旧 `TaskStore` 与 `OrchestrationService` 暂时保留为 legacy 兼容代码，新任务计划流程不依赖它们。

当前仍建议后续补强完整 HTTP hook -> TaskPlanService -> Claude observation 的端到端测试、离线失败路径的二次状态事件、文件级冲突检测、自动 worktree 隔离和 Agent 输出摘要提取。

## 背景

当前 UI 里的“受控编排”和“任务看板”已经不适合主流程。“受控编排”是固定的 Claude -> Codex -> Gemini 三步骨架，不能覆盖真实工作中由 Claude 动态管理任务、审查结果、决定下一步的场景。“任务看板”是 workspace 级别的简单任务列表，缺少 plan_id、计划目录、hook 归属、产物文件和管理会话上下文。

新方向是把这两个模块替换为“任务计划”。AgentHub 不再扮演项目经理，也不内置复杂决策大脑。Claude 作为管理者，AgentHub 负责保存计划、投递消息、接收 hook、记录状态、展示进度。

## 目标

- 用“任务计划”替换 UI 中的“受控编排”和“任务看板”。
- 每个任务计划独立归档到日期时间目录，支持历史选择和查看。
- 新建 `TaskPlanStore`，不复用旧 `TaskStore`。
- 支持用户从项目 `tasks/<时间-标题>/task-plan.md` 创建任务计划快照。
- 支持把指定任务计划交给 Claude 管理。
- 支持 Codex/Gemini 通过 hook 回传结果，并由 AgentHub 通知 Claude。
- 支持 Claude 审查通过后派发下一个子任务，审查不通过时把原因转回执行者。

## 非目标

- 第一版不做内置 API 大脑。
- 第一版不让 AgentHub 自动理解 Markdown 并自行决定任务顺序。
- 第一版不复用 `<workspace>/.agenthub/tasks/tasks.jsonl`。
- 第一版不要求多个任务计划并行自动执行；可以同时存在多个计划，但同一计划先按单管理者流程推进。

## 存储结构

当前任务计划的权威编辑文件放在项目根目录的 `tasks/` 文件夹下，每个子目录代表一个独立任务：

```text
<workspace>/tasks/
  20260505-1530-agenthub-ui/
    task-plan.md
    notes.md
    results/
  20260505-1715-hook-fix/
    task-plan.md
```

`task-plan.md` 由用户手写，或由 Agent 讨论后生成。同一个任务的补充材料、讨论记录和结果文件可以放在同一个 `tasks/<时间-标题>/` 目录里。AgentHub 不把任务计划正文当作 UI 输入内容，也不在第一版主动改写这些来源文件。用户点击创建任务计划时，AgentHub 读取选中的 `tasks/<时间-标题>/task-plan.md`，并为本次执行保存一份历史快照。

每个任务计划快照独立放在 workspace 内：

```text
<workspace>/.agenthub/task-plans/
  2026-05-04/
    213012-agenthub-ui-refactor/
      plan.json
      task-plan.md
      tasks.jsonl
      events.jsonl
      artifacts/
        T001-codex-result.md
        T001-claude-review.md
```

目录命名规则：

- 日期目录：`YYYY-MM-DD`。
- 计划目录：`HHmmss-slug`。
- `plan.id` 使用稳定 ID：`YYYYMMDD-HHmmss-slug`。
- `slug` 从标题生成，无法生成时使用 `task-plan`。

## 文件职责

`plan.json` 保存计划元信息：

```json
{
  "id": "20260504-213012-agenthub-ui-refactor",
  "title": "AgentHub UI Refactor",
  "status": "draft",
  "managerProfileId": "claude",
  "participantProfileIds": ["codex", "gemini"],
  "sourceTaskDir": "V:/AgentGroup/tasks/20260505-1530-agenthub-ui",
  "sourcePlanPath": "V:/AgentGroup/tasks/20260505-1530-agenthub-ui/task-plan.md",
  "createdAt": "2026-05-04T13:30:12.000Z",
  "updatedAt": "2026-05-04T13:30:12.000Z"
}
```

`.agenthub/task-plans/.../task-plan.md` 保存创建计划时的快照。它是这次执行和历史查看的稳定版本；如果来源 `tasks/<时间-标题>/task-plan.md` 后续变化，应创建新的任务计划快照。

`tasks.jsonl` 保存结构化子任务状态：

```json
{"id":"T001","title":"重构主界面 Tab","status":"pending","assigneeProfileId":"codex","attempt":0}
{"id":"T002","title":"接入 hook 回调","status":"pending","assigneeProfileId":"codex","attempt":0}
```

`events.jsonl` 保存计划内事件：

```json
{"type":"assigned","taskId":"T001","fromProfileId":"claude","toProfileId":"codex","timestamp":"..."}
{"type":"hook_completed","taskId":"T001","fromProfileId":"codex","timestamp":"..."}
{"type":"review_failed","taskId":"T001","fromProfileId":"claude","timestamp":"..."}
```

`artifacts/` 保存每个任务的长文本产物、审查意见和摘要。聊天区只显示摘要和路径。

## 新模块

`desktop/src/main/task-plan-store.ts`

- 创建计划目录。
- 扫描 `<workspace>/tasks/*/task-plan.md`。
- 从选中的任务目录读取任务计划正文。
- 读写 `plan.json`。
- 写入并读取历史快照 `task-plan.md`。
- append/read `tasks.jsonl`。
- append/read `events.jsonl`。
- 写入和读取 `artifacts/` 文件。
- 按日期列出计划。

`desktop/src/main/task-plan-service.ts`

- 从选中的 `tasks/<时间-标题>/task-plan.md` 创建任务计划快照。
- 启动 Claude 管理指定计划。
- 处理 hook 完成事件并写入 plan event。
- 把执行结果通知 Claude。
- 接收 Claude 的 `<agenthub>` 控制命令并派发任务给 Codex/Gemini。

旧 `TaskStore` 标记为 legacy，仅用于历史任务看板代码。新任务计划流程不依赖它。

## 管理流程

### 创建计划

1. 用户或 Agent 在 `tasks/<时间-标题>/task-plan.md` 准备好任务计划。
2. 用户在 UI 中点击“新建任务计划”。
3. AgentHub 创建日期时间目录。
4. AgentHub 读取选中的来源文件，写入 `plan.json` 和快照 `task-plan.md`。
5. 可选：用户手动编辑结构化子任务，或由 Claude 后续读取快照后通过命令创建子任务。

### 交给 Claude 管理

1. 用户选择任务计划，点击“交给 Claude 管理”。
2. AgentHub 找到在线 Claude session。
3. AgentHub 给 Claude 发送管理 prompt，包含：
   - plan_id
   - 来源任务目录
   - 来源 `task-plan.md` 路径
   - 本次执行快照 `task-plan.md` 路径
   - `tasks.jsonl` 路径
   - 可用 Agent 列表
   - 可用 `<agenthub>` 命令
4. Claude 决定下一个子任务，并通过 `<agenthub>` 命令让 AgentHub 派发给 Codex 或 Gemini。

### Codex 执行与 hook 回传

1. AgentHub 把 Claude 派发的子任务发送给 Codex。
2. Codex 在独立终端执行。
3. Codex 完成后，hook POST 回 AgentHub。
4. Hook 必须携带或可回填：
   - plan_id
   - task_id
   - profile_id
   - session_id
   - run_id
   - summary
5. AgentHub 写入 artifact 和 `events.jsonl`。
6. AgentHub 自动通知 Claude：子任务完成，请审查。

### Claude 审查

Claude 审查后通过 `<agenthub>` 命令选择：

- `approve_task`：标记任务完成，并派发下一项。
- `reject_task`：记录不通过原因，并把修改意见发回 Codex。
- `request_review`：把任务结果交给 Gemini 审查。
- `pause_plan`：计划暂停，等待用户介入。

## 控制协议

第一版新增计划级命令，保留现有 `send_message` 的精神，但所有任务流必须带 `plan_id`。

```text
<agenthub>{"action":"assign_task","plan_id":"...","task_id":"T001","to":"codex","message":"请实现 T001"}</agenthub>
```

```text
<agenthub>{"action":"approve_task","plan_id":"...","task_id":"T001","summary":"实现通过"}</agenthub>
```

```text
<agenthub>{"action":"reject_task","plan_id":"...","task_id":"T001","to":"codex","message":"测试缺失，请补充"}</agenthub>
```

```text
<agenthub>{"action":"request_review","plan_id":"...","task_id":"T001","to":"gemini","message":"请审查实现风险"}</agenthub>
```

```text
<agenthub>{"action":"pause_plan","plan_id":"...","reason":"需要用户确认 API 设计"}</agenthub>
```

## UI 设计

“协作消息” Tab 下移除旧“受控编排”和旧“任务看板”，替换为“任务计划”面板。

面板结构：

```text
任务计划
  日期列表
  当前日期的计划列表
  当前计划内容
    - task-plan.md 预览
    - 子任务状态
    - 事件时间线
  操作按钮
    - 从选中的 tasks 目录创建快照
    - 交给 Claude 管理
    - 暂停管理
    - 打开计划目录
```

聊天区继续显示用户和 Agent 的协作消息。任务计划面板负责展示计划文档、结构化状态和运行事件。

## Hook 归属

AgentHub 启动 Agent 时继续注入环境变量。任务计划派发时，AgentHub 需要把 `AGENTHUB_PLAN_ID` 和 `AGENTHUB_TASK_ID` 作为本次消息上下文传给目标 Agent。Hook 回调时优先使用 hook payload 中的 plan/task 信息；如果缺失，则根据 `session_id/run_id` 回填最近一次派发记录。

如果无法确定归属，事件写入 workspace 级错误流，不自动推进计划。

## 失败处理

- Claude 不在线：计划保持 `draft` 或 `paused`，UI 提示需要启动 Claude。
- Codex/Gemini 不在线：写入计划事件 `delivery_failed`，通知 Claude 或用户。
- Hook 缺少 plan_id/task_id 且无法回填：写入 `unmatched_hook`，不推进任务。
- Claude 命令 JSON 无法解析：写入 `parse_error`，计划暂停。
- 审查不通过超过最大次数：任务标记 `blocked`，计划暂停。

## 迁移策略

- 旧 `OrchestrationService` 暂时保留，但 UI 不再暴露为主入口。
- 旧 `TaskStore` 暂时保留，但新 Task Plan 不依赖它。
- 旧 `<workspace>/.agenthub/tasks/tasks.jsonl` 不自动迁移。
- 后续确认新任务计划稳定后，再删除或归档旧 UI 入口和旧服务。

## 测试策略

- `TaskPlanStore` 单测：
  - 创建计划目录。
  - 按日期列出计划。
  - 读写 `plan.json`、`task-plan.md`、`tasks.jsonl`、`events.jsonl`。
  - 阻止路径穿越。
- `TaskPlanService` 单测：
  - 启动 Claude 管理时发送正确 prompt。
  - Claude `assign_task` 命令会派发到 Codex。
  - Hook 完成会写 artifact 并通知 Claude。
  - `approve_task`、`reject_task`、`request_review` 更新计划事件。
- Renderer 单测：
  - UI 不再显示旧“受控编排”和旧“任务看板”。
  - 显示“任务计划”入口。
  - 日期和计划选择状态稳定。
