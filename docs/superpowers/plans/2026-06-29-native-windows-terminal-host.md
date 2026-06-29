# Native Windows Terminal Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-only native AgentHub prototype that uses a Windows Terminal backend terminal view, starts Codex/Claude/Gemini through PowerShell in selected workspaces, and keeps AgentHub input control plus hook-based semantic communication.

**Architecture:** Add a parallel `native/AgentHub.Native/` solution beside the existing Electron app. `AgentHub.Native.Core` owns testable launch plans, hook environment construction, hook receiver, hook installer, and input routing abstractions. `AgentHub.Native.App` is a WPF shell that hosts `EasyWindowsTerminalControl` and wires UI actions to Core plans.

**Tech Stack:** C#、.NET 10 Windows、WPF、xUnit、EasyWindowsTerminalControl、PowerShell、Windows ConPTY / Windows Terminal backend.

---

## 已实现任务

- [x] 创建 `native/AgentHub.Native/AgentHub.Native.slnx`。
- [x] 创建 `AgentHub.Native.Core`、`AgentHub.Native.Core.Tests`、`AgentHub.Native.App`。
- [x] 用测试驱动实现 `AgentLaunchPlanBuilder`。
- [x] 用测试驱动实现 `WindowsCommandLineBuilder`。
- [x] 用测试驱动实现 `HookEnvironmentBuilder`。
- [x] 用测试驱动实现 `AgentHookReceiver`。
- [x] 用测试驱动实现 `ProjectAgentHookInstaller`。
- [x] 用测试驱动实现 `AgentInputRouter`。
- [x] WPF App 接入 `EasyWindowsTerminalControl`。
- [x] WPF App 接入 hook receiver、hook installer、hook env 注入和输入栏。
- [x] 多 session 列表支持 Stop selected、Stop all、切换时保留各自 terminal 实例。
- [x] session 列表显示 profile、workspace、runId 和 hook receiver 状态。
- [x] hook 控制命令的解析错误和转发失败会进入 Collaboration timeline。
- [x] provider-neutral `claim_task` / `complete_task` 团队状态命令会进入 Collaboration timeline。
- [x] provider-neutral team 命令会写入 `<workspace>/.agenthub/teams/<teamId>/mailbox.jsonl`。
- [x] native `send_message` mailbox 记录会继承 hook 事件上的 `teamId` / `conversationId` 上下文，避免命令漏写时掉回 default mailbox 或丢 conversation。
- [x] 任务计划路由命令转发后的 mailbox 记录会保留 `planId`，方便后续 task-plan 状态机迁移。
- [x] `assign_task` / `request_review` / `reject_task` / `approve_task` / `pause_plan` 任务计划命令会写入 `<workspace>/.agenthub/task-plans/native/<planId>/events.jsonl`。
- [x] native Core 支持扫描 `<workspace>/tasks/*/task-plan.md`，并从选中的任务目录创建 `.agenthub/task-plans/YYYY-MM-DD/HHmmss-slug/` 执行快照。
- [x] native Core 支持创建 task-plan 并向当前 workspace 的 manager profile 最新 session 投递 manager prompt；无 manager session 时记录 `delivery_failed`。
- [x] native App 提供 task-plan 来源刷新、执行快照创建、计划选择和启动 manager 的基础 UI 入口。
- [x] native App 在 hook manager 命令转发后，会把 `assign_task` / `request_review` / `reject_task` / `approve_task` / `pause_plan` 同步写入执行快照的 `tasks.jsonl` / `events.jsonl`。
- [x] native dispatcher 会把 `assign_task` / `reject_task` / `request_review` 转换成带 plan/task/from 上下文的标准 prompt，再投递到目标 Agent。
- [x] native task-plan hook completion 会写入 `artifacts/*.md`，把 delegated task 置为 `review`，并把 observation prompt 投递回 manager session；manager 不在线时记录带 task/artifact 上下文的 `delivery_failed`。
- [x] native App 会在选中 task-plan 执行快照后展示最新 task 状态和最近 event，hook 回传后自动刷新当前 plan detail。
- [x] native App 在当前 workspace 收到 hook 后会刷新 Task Plans 列表，确保 paused/running 等 plan 状态能及时反映到 UI。
- [x] native App 支持从 Task plan detail 打开执行快照目录，便于查看 `artifacts/`、`tasks.jsonl` 和 `events.jsonl`。
- [x] native Core 和 App 支持用户手动 Pause/Resume/Archive task-plan，并把状态变化写入执行快照 events 和 Collaboration timeline。
- [x] native hook processor 会把 Collaboration `agent_output` 事件 id 透传到 task-plan 执行快照事件，方便后续追踪和去重。
- [x] native task-plan hook completion 会按 `sourceEventId` 幂等处理重复回传，避免重复写 artifact 或重复通知 manager。
- [x] native hook receiver 支持从 payload 读取显式 `planId/taskId`、`plan_id/task_id`，也兼容 `X-AgentHub-Plan-Id` / `X-AgentHub-Task-Id` header，并在显式 plan 无法匹配 task 时记录 `unmatched_hook`。
- [x] native hook receiver/timeline 支持 `conversationId/conversation_id`、`teamId/team_id` 及对应 header，并把 conversation/task/team/plan 元数据写入 Collaboration event。
- [x] provider-neutral `claim_task` / `complete_task` 会同步更新已有 legacy task log。
- [x] provider-neutral `ask_user` / `done` workflow 命令会进入 Collaboration timeline。
- [x] provider-neutral `continue` / `accept` pair negotiation 命令会进入 Collaboration timeline；带 `message_to` 时会直接转发给目标 profile 并记录 default mailbox。
- [x] native Core 提供 append-only `AgentConversationStore`，状态保存到 `<workspace>/.agenthub/conversations/conversations.jsonl`，支持 create/update/list、坏 JSONL 行容错和最新状态去重。
- [x] native Core 提供 manager conversation 启动切片：创建 conversation、投递初始 manager prompt、推进 `currentStep`，并在 supervisor session 缺失或投递失败时标记 `failed`。
- [x] native Core 提供 manager `handleAgentOutput` 的 supervisor 命令切片：`send` / `send_message` 投递 delegated prompt 并推进 `currentStep`，`done` 完成 conversation，`ask_user` 暂停 conversation。
- [x] native WPF hook pipeline 已接入 conversation 分流：running conversation hook 会绕过通用 dispatcher 并交给 `AgentConversationOrchestrator`，避免同一条 `send` 命令重复发送。
- [x] native Core 支持 manager participant observation：participant hook 显式带 `conversationId/taskId` 时会投回 supervisor；真实 hook 不带 metadata 时，会从最近一次 delegated event 的 `conversationId/taskId/sessionId` 推断上下文并生成 observation prompt。
- [x] native Core 支持 roundtable conversation：启动时按 `claude -> codex -> gemini` 优先顺序规范参与者并投递第一轮 prompt；hook 回传时按顺序转发给下一位；达到 `maxSteps` 后完成 conversation。
- [x] native Core 支持两人 pair negotiation conversation：启动时创建 `.agenthub/conversations/<id>/brief.md`、`memory.md`、`state.json` 和 `turns/`，投递带 `artifact_path` 的文件型 prompt；`continue` 会校验或补写当前 turn artifact 后投递给另一位参与者，双方 `accept` 同一 `proposal_version` 后完成；达到 `maxSteps` 后暂停。
- [x] native App 提供 Conversations 基础 UI 入口：输入 topic 和 participants 后，可直接启动 manager、roundtable 或 pair negotiation conversation。
- [x] native App 提供 conversation 列表、详情和打开目录入口；切换 workspace、启动 conversation 或当前 workspace 收到 hook 回传后会刷新状态。
- [x] native Core 和 App 支持用户手动 Pause/Resume/Stop conversation 编排状态，并把状态变化写入 Collaboration timeline。
- [x] 协作层迁移已落到 native Core/App：conversation/task-plan 编排逻辑在 native Core 中执行，输入仍走 `AgentInputRouter`，hook 结果仍走 `AgentHookReceiver` 和 native hook pipeline。
- [x] native 启动脚本和 WPF UI 的 hook Python 默认值统一为 `py -3.11`，避免装有 Python 3.14 的机器误选不兼容版本；显式 `-Python` 仍可覆盖。
- [x] native Codex 启动和恢复命令会自动追加 `--no-alt-screen`，避免 Codex TUI 进入 alternate screen 后丢失普通 scrollback。
- [x] native UI 预检和 `scripts/start-native.ps1 -Check` 会提前确认 Codex CLI 支持 `--no-alt-screen`，避免旧 Codex 版本启动后才失败。
- [x] native UI 和 `scripts/start-native.ps1 -Check` 的 Agent CLI 解析都优先使用 Windows native launcher（`.com`、`.exe`、`.bat`、`.cmd`），避免 npm 同时生成 `codex.ps1` 和 `codex.cmd` 时预检走到 PowerShell shim。
- [x] native 诊断报告会独立记录 Codex native launcher 解析结果和 `--no-alt-screen` 探测结果，发布包模式下没有源码 `start-native.ps1` 时也能回传这些信息。
- [x] native 发布包同时提供 `.bat` 和 `.ps1` 根入口；NAS/UNC 路径下可用 `.ps1` 启动或生成诊断，避免 `cmd.exe` 的 UNC 当前目录提示干扰报告。
- [x] native 诊断报告会采集 Windows Terminal 包信息、settings 文件存在性和 Console Host 注册表关键项，方便对比不同电脑的滚动/终端环境差异。
- [x] native 诊断报告会采集源码项目的终端后端依赖和发布包 deps manifest，方便对比 EasyWindowsTerminalControl / Windows Terminal 后端版本差异。
- [x] native 诊断报告会采集 `Win32_PointingDevice` 和 Precision Touchpad 设置，方便对比笔记本触摸板/指针设备对滚动行为的影响。
- [x] native App 和启动脚本提供 `Scroll Test` / `-Agent scrolltest`，用普通 PowerShell 输出 240 行文本作为 Codex 以外的终端滚动对照组。
- [x] native UI 提供 `Run diagnostics`，可用当前 workspace 直接生成诊断报告到 native data 的 `diagnostics/` 目录。
- [x] native UI 诊断完成后会更新 `diagnostics/latest-diagnostics.txt`，方便定位最近一次报告。
- [x] 提供 `scripts/validate-native-laptop.ps1`，一键执行笔记本 Codex/scrolltest 预检并生成诊断报告。
- [x] native 发布包提供 `validate-native-laptop.ps1/.bat`，目标电脑不依赖源码仓库也能检查包文件、workspace 路径、Codex、hook Python，并生成验证指针和诊断报告。
- [x] native 验证脚本支持 `-Agent agents`，可选覆盖 Codex、Claude、Gemini 三类托管 Agent 的 CLI 预检。
- [x] native 诊断脚本和 UI `Run diagnostics` 支持传递 Agent 选择；UI 默认按 `agents` 采集 Codex、Claude、Gemini 预检信息。
- [x] native UI 提供 `Write validation`，可生成带 workspace、诊断指针、hook log、session 列表和人工勾选项的手工验证报告。

## 后续任务

### Task 1: 笔记本 Codex 滚动验证

Run:

```powershell
cd native/AgentHub.Native
dotnet run --project src/AgentHub.Native.App/AgentHub.Native.App.csproj
```

验证：

- 运行 `scripts/validate-native-laptop.ps1`，确认能生成报告和 latest-laptop-validation.txt。
- 启动 Codex。
- 启动 Scroll Test，确认普通 scrollback 是否能滚动。
- 点击 Run diagnostics，确认能生成报告和 latest-diagnostics.txt。
- 执行或进入 resume。
- 检查滚动条是否出现。
- 检查鼠标滚轮和触摸板滚动。
- 使用 AgentHub 输入栏发送一行文本。
- 等待 Codex 产生最终消息，确认 Hook 消息列表收到回传。

## 验证命令

```powershell
dotnet test native/AgentHub.Native/AgentHub.Native.slnx
dotnet build native/AgentHub.Native/AgentHub.Native.slnx
python -m pytest -q
```
