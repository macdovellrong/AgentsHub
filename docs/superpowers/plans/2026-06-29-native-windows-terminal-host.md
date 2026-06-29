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
- [x] 任务计划路由命令转发后的 mailbox 记录会保留 `planId`，方便后续 task-plan 状态机迁移。
- [x] `assign_task` / `request_review` / `reject_task` / `approve_task` / `pause_plan` 任务计划命令会写入 `<workspace>/.agenthub/task-plans/native/<planId>/events.jsonl`。
- [x] native Core 支持扫描 `<workspace>/tasks/*/task-plan.md`，并从选中的任务目录创建 `.agenthub/task-plans/YYYY-MM-DD/HHmmss-slug/` 执行快照。
- [x] native Core 支持创建 task-plan 并向当前 workspace 的 manager profile 最新 session 投递 manager prompt；无 manager session 时记录 `delivery_failed`。
- [x] native App 提供 task-plan 来源刷新、执行快照创建、计划选择和启动 manager 的基础 UI 入口。
- [x] native App 在 hook manager 命令转发后，会把 `assign_task` / `request_review` / `reject_task` / `approve_task` / `pause_plan` 同步写入执行快照的 `tasks.jsonl` / `events.jsonl`。
- [x] native task-plan hook completion 会写入 `artifacts/*.md`，把 delegated task 置为 `review`，并把 observation prompt 投递回 manager session；manager 不在线时记录带 task/artifact 上下文的 `delivery_failed`。
- [x] native App 会在选中 task-plan 执行快照后展示最新 task 状态和最近 event，hook 回传后自动刷新当前 plan detail。
- [x] provider-neutral `claim_task` / `complete_task` 会同步更新已有 legacy task log。
- [x] provider-neutral `ask_user` / `done` workflow 命令会进入 Collaboration timeline。
- [x] provider-neutral `continue` / `accept` pair negotiation 命令会进入 Collaboration timeline；带 `message_to` 时会直接转发给目标 profile 并记录 default mailbox。当前不执行完整 pair negotiation 状态机。

## 后续任务

### Task 1: 笔记本 Codex 滚动验证

Run:

```powershell
cd native/AgentHub.Native
dotnet run --project src/AgentHub.Native.App/AgentHub.Native.App.csproj
```

验证：

- 启动 Codex。
- 执行或进入 resume。
- 检查滚动条是否出现。
- 检查鼠标滚轮和触摸板滚动。
- 使用 AgentHub 输入栏发送一行文本。
- 等待 Codex 产生最终消息，确认 Hook 消息列表收到回传。

### Task 2: 协作层迁移

- 把现有 Electron 版 conversation/task-plan 编排逻辑迁入 native Core，或先通过 IPC/HTTP 复用现有服务。
- 输入仍走 `AgentInputRouter`。
- 结果仍走 `AgentHookReceiver`。

## 验证命令

```powershell
dotnet test native/AgentHub.Native/AgentHub.Native.slnx
dotnet build native/AgentHub.Native/AgentHub.Native.slnx
python -m pytest -q
```
