# Repository Guidelines

## 项目结构与模块组织

当前主线是 `desktop/`：Electron + React + xterm.js + node-pty。旧 Python/PyQt 原型只保留为参考，不再作为主入口。

- `desktop/src/main/`：Electron 主进程、IPC、PTY session、hook receiver、事件/run/conversation/task-plan 存储与编排服务。
- `desktop/src/preload/`：安全暴露给 renderer 的 IPC bridge。
- `desktop/src/renderer/`：React HMI、协作消息、终端 Tab、任务计划和运行记录 UI。
- `desktop/src/shared/`：前后端共享 IPC 类型与运行时 guard。
- `scripts/hooks/`：Codex、Claude、Gemini 回调脚本。
- `docs/superpowers/`：设计 spec 与实现计划。
- `tests/`：legacy Python 参考实现测试。

运行期数据写入 `<workspace>/.agenthub/`，不要提交日志、缓存、虚拟环境或 `.agenthub/`。任务计划来源文件位于 `<workspace>/tasks/<时间-标题>/task-plan.md`，`.agenthub/task-plans/.../task-plan.md` 只是创建计划时的历史快照。

## 开发、测试与运行命令

```powershell
cd desktop
npm install
npm run dev
```

启动 Electron HMI。若 UNC 路径下 node-pty 构建失败，先把共享目录映射为盘符再运行。

```powershell
cd desktop
npm run typecheck
npm test
npm run build
```

执行 TypeScript 检查、Vitest 测试和生产构建。

```powershell
python -m pytest -v
```

运行 Python 参考实现与 hook 脚本测试。

## 编码风格与命名约定

TypeScript 使用明确类型、窄接口和小型纯 helper；IPC 请求必须在 `desktop/src/shared/ipc.ts` 中定义类型与 guard。Python 使用 3.11+、4 空格缩进、类型标注。模块边界保持清晰：UI 不直接处理 PTY，进程层不直接写 React 状态。

## 测试规范

Electron 测试使用 Vitest，测试文件命名为 `*.test.ts`。行为变更优先写失败测试，再实现。Windows/PTY/hook 行为要覆盖正常路径和失败路径。提交前至少运行 `cd desktop; npm run typecheck; npm test`；涉及 hook 或旧原型时运行 `python -m pytest -v`。

## 已完成任务

- Electron 主线 UI：多 workspace、多 profile、独立 xterm 终端、run/event/forward/conversation 持久化。
- 中央协作消息：支持 `@profile` 定向发送、引用转发、Agent hook 输出进入聊天区。
- hook 服务：程序启动时自动开启本地 HTTP 回调服务，并向 PTY session 注入 `AGENTHUB_HOOK_*` 环境变量。
- Codex/Claude/Gemini hook 脚本：从各自 transcript/payload 提取最终消息并 POST 回 AgentHub。
- Conversation 编排：manager、roundtable、pair negotiation、文件型协商 memory/artifact、实时事件刷新。
- Task Plan 主线：`TaskPlanStore` 扫描 `<workspace>/tasks/*/task-plan.md` 并从选中的任务目录创建历史快照，数据位于 `<workspace>/.agenthub/task-plans/YYYY-MM-DD/HHmmss-slug/`。
- Task Plan 流程：Claude manager 可通过 `assign_task`、`request_review`、`approve_task`、`reject_task`、`pause_plan` 指挥 Codex/Gemini。
- Task Plan hook 回填：支持 `planId/plan_id/x-agenthub-plan-id`，hook 结果写 artifact、记录 plan event，并自动观察回 Claude。
- Task Plan 安全性：artifact 不覆盖、坏 JSONL 行容错、planPath 防篡改、hook 事件幂等、非 manager 命令拒绝、observer 隔离。
- Task Plan IPC/UI：支持 list sources/list/create/read/start manager/open folder；“新建任务计划”读取选中的 `tasks/<时间-标题>/task-plan.md`，不再粘贴 Markdown 正文。

## 未完成与后续增强项

- 增加完整 HTTP hook -> TaskPlanService -> Claude observation 的端到端测试。
- 离线失败路径可追加二次状态事件，让 UI 不依赖下一次刷新。
- 更细粒度文件冲突检测、自动 worktree 隔离、Agent 输出摘要提取和更完整的编排状态机。
- 旧 `TaskStore` 与 `OrchestrationService` 暂时保留为 legacy 兼容代码；新任务计划流程不依赖它们。

## 提交与 PR 规范

提交保持单一逻辑变更，例如 `feat: add task plan manager`。PR 说明变更内容、测试结果和影响范围；UI 改动附截图；涉及 PTY、workspace、hook、事件持久化的改动必须说明兼容性和数据路径。
