# AgentHub Native

这是 C2 方向的 Windows-only 原生原型：AgentHub 保留 Agent session 控制权，同时把终端显示层替换成基于 Windows Terminal 后端的 WPF 控件。

## 技术栈

- C# / .NET 10
- WPF
- EasyWindowsTerminalControl
- Windows Terminal backend / ConPTY
- 默认 PowerShell host，可在界面切换为 cmd

## 运行

推荐从仓库根目录启动：

```powershell
.\start-agenthub-native.bat
```

或使用 PowerShell 脚本：

```powershell
.\scripts\start-native.ps1
```

启动时直接加入并选中某个 workspace：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager
.\start-agenthub-native.bat -Workspace V:\OrderManager
```

启动时直接打开某个 Agent；`-Resume` 仅对 Codex 生效：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent codex -Resume
.\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent claude
```

也可以一次启动多个 Agent，按列表顺序启动；`-Resume` 仍只影响 Codex：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent codex,claude,gemini -Resume
.\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex,claude,gemini -Resume
```

启动时指定 Host shell：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Shell powershell -Agent codex -Resume
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Shell cmd -Agent codex
```

启动普通 shell 时也可以直接指定 `powershell` 或 `cmd`：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent cmd
```

`shell` 是普通 shell 的默认别名，等价于 `powershell`；需要 cmd 时请使用 `-Agent cmd` 或 `-Shell cmd`。

启动时指定 Agent hook 使用的 Python 命令；未指定时默认使用 `py -3`：

```powershell
.\scripts\start-native.ps1 -Workspace V:\OrderManager -Agent codex -Resume -Python "C:\Program Files\Python311\python.exe"
.\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume -Python "py -3.11"
```

只检查环境和路径、不启动 UI：

```powershell
.\scripts\start-native.ps1 -Check
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell powershell -Agent codex -Python "py -3.11"
.\scripts\start-native.ps1 -Check -Workspace V:\OrderManager -Shell cmd -Agent codex,claude,gemini -Python "py -3.11"
```

`-Check` 会在不启动 UI 的情况下检查项目、可选 workspace 路径和可选 Host shell。带 `-Agent` 时会检查对应的 Agent CLI 是否在 PATH 中。`powershell`、`cmd`、`shell` 只使用选中的 Host shell，不检查额外 Agent CLI。只有 `codex`、`claude`、`gemini` 这类需要安装 hook 的 Agent 会检查 hook Python 命令和 hook 脚本目录；如果设置了 `AGENTHUB_HOOKS_SOURCE_DIR`，预检会检查该目录，否则检查仓库内 `scripts/hooks`。

## 发布

在开发机生成可复制到其他 Windows 电脑的发布目录：

```powershell
.\scripts\publish-native.ps1
```

默认输出到 `artifacts/native/win-x64`，并复制 Agent hook 脚本到发布目录内的 `scripts/hooks`。发布后可以在目标电脑运行：

```powershell
.\artifacts\native\win-x64\start-agenthub-native.bat -Workspace V:\OrderManager -Agent codex -Resume
```

发布版 `start-agenthub-native.bat` 会直接调用 native exe，并将 `AGENTHUB_HOOKS_SOURCE_DIR` 固定为发布包内的 `scripts/hooks`，避免目标机器残留的同名环境变量指向旧 hook。native exe 同时兼容 `-Workspace/-Agent/-Shell/-Python/-Resume` 和 `--workspace/--agent/--shell/--python/--resume` 两种参数风格。

只检查发布环境、不执行发布：

```powershell
.\scripts\publish-native.ps1 -Check
```

也可以直接运行项目：

```powershell
cd native/AgentHub.Native
dotnet run --project src/AgentHub.Native.App/AgentHub.Native.App.csproj
```

## 当前流程

左侧 Conversations 区域可以输入 topic 和 participants；默认 participants 是 `claude,codex`。`Start manager` 会以 Claude 作为 supervisor，把其余参与者作为 workers；`Roundtable` 会按参与者顺序轮转；`Pair` 要求正好两名参与者。
右侧底部 Conversations 面板会列出当前 workspace 的 conversation 状态、步数、参与者和持久化目录；启动 conversation 或当前 workspace 收到 hook 回传后会自动刷新，也可以手动 Refresh，并用 Open 打开 `.agenthub/conversations/<id>` 目录查看 `brief.md`、`memory.md`、`state.json` 和 `turns/*.md`。选中 conversation 后可以用 Pause/Resume/Stop 控制编排状态，状态变化会写入 Collaboration timeline。

1. 启动 native app。
2. 输入已存在的 workspace 路径并点击 Add，或点击 Browse 选择目录并加入工作区列表；如果列表中已有选中项，输入框或 Browse 新选中的路径会优先生效。
   Open 会打开当前输入框或选中项解析出的 workspace 目录；Remove 会优先删除列表中选中的 workspace，选中项为空时才使用输入框路径。
3. app 会在该 workspace 的 `.gitignore` 中幂等加入 `.agenthub/`、`.codex/`、`.claude/`、`.gemini/`。
4. 选中 workspace 后选择 Host shell，默认 PowerShell，也可以切换为 cmd。
5. 启动 Codex、Claude、Gemini 或普通 shell session。
6. 对托管 Agent，app 会安装项目级 `.codex`、`.claude`、`.gemini` hooks。
7. app 会启动本地 hook receiver，并向 PowerShell/cmd-hosted session 注入 `AGENTHUB_HOOK_*` 环境变量。
8. 可以用底部输入栏向选中的 terminal session 发送文本；Enter 发送，Shift+Enter 在输入框内换行。多行文本会用 bracketed paste 写入终端，再发送 Enter。
9. 也可以在输入栏左侧选择 `codex`、`claude`、`gemini`、`powershell` 或 `cmd`，按列表中选中的 workspace/profile 路由到最新 session；没有选中 workspace 时才使用输入框路径。
10. 输入栏支持 `@codex message`、`@claude message`、`@gemini message`、`@powershell message`、`@cmd message` 直接定向发送，定向消息正文可以是多行。
11. Agent hook 回传如果包含 `<agenthub>{"action":"send_message","to":"codex","message":"..."}</agenthub>`、旧格式 `<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"..."}</agenthub>`，或任务计划路由命令 `assign_task` / `reject_task` / `request_review`，native app 会按当前 workspace 路由到目标 profile 的最新 session，并把 sent/failed 结果写入 native task-plan events；`approve_task` / `pause_plan` 会被识别为任务计划状态命令并显示在 timeline 中，也会写入 native task-plan events；`claim_task` / `complete_task` 会被识别为团队状态命令并显示在 timeline 中；`ask_user` / `done` 会被识别为 workflow 命令并显示在 timeline 中；pair negotiation 的 `continue` / `accept` 会被识别为协商命令并显示在 timeline 中，如果命令显式带 `message_to`，native app 会把 `message`、`summary` 或 `artifact_path` 生成的内容直接转发给目标 profile，并写入 default mailbox。对于已经创建的 native `pair_negotiation` conversation，hook pipeline 会绕过通用 dispatcher，由 conversation orchestrator 按两名参与者轮转 `continue`，并在双方接受同一 `proposal_version` 后完成 conversation；文件型协商会写入 `.agenthub/conversations/<id>/brief.md`、`memory.md`、`state.json` 和 `turns/*.md`。当前 native 原型暂不执行完整任务计划状态机。
12. 用户发送的消息、hook 回传，以及 AgentHub 从 hook 命令自动转发给目标 Agent 的消息都会显示在 Collaboration timeline 列表中。用户从输入栏手动发送消息时，会保留当前选中的 `conversationId` 和 `planId`，方便人工介入后继续按 conversation/task-plan 追踪；hook 回传写入 timeline 时会保留 `conversationId`、`taskId`、`teamId`、`planId` 等元数据，供后续 conversation/task-plan 编排继续使用。
13. provider-neutral team 命令会写入 `<workspace>/.agenthub/teams/<teamId>/mailbox.jsonl`；`send_message` 记录 sent/failed，`claim_task` / `complete_task` 记录 observed；任务计划路由命令转发后的 mailbox 记录会保留 `planId`。如果 hook 回传携带 `teamId` 或 `conversationId`，而 `send_message` 命令没有重复声明，mailbox 会继承 hook 的 team/conversation 上下文。
14. `claim_task` / `complete_task` 也会尝试更新 `<workspace>/.agenthub/tasks/tasks.jsonl` 中已有 legacy task 的状态；缺少对应 task 时不会阻断 hook 处理。
15. 左侧 Task Plans 区域可以刷新 `<workspace>/tasks/*/task-plan.md` 来源、创建 task-plan 执行快照，并把 manager prompt 投递给当前 workspace 的 manager profile 最新 session；选中执行快照后，右侧 Task plan detail 会显示最新 tasks 和最近 events，也可以用 Open 打开执行快照目录查看 `artifacts/`、`tasks.jsonl` 和 `events.jsonl`。用户可以手动 Pause、Resume 或 Archive 当前 task-plan，状态变化会写入执行快照 events 和 Collaboration timeline。
16. manager hook 输出的 `assign_task` / `reject_task` / `request_review` 会向目标 Agent 发送带 plan/task/from 上下文的标准 prompt，而不是只转发裸 message；`approve_task` / `pause_plan` 不会投递到终端，只会更新 task-plan 状态记录。所有 manager task-plan 命令都会同步写入执行快照内的 `tasks.jsonl` / `events.jsonl`。
17. delegated agent 的 hook 回传会从最近的 task-plan 分派事件推断 plan/task；hook payload 也可以显式带 `planId/taskId` 或 `plan_id/task_id`，HTTP header 也兼容 `X-AgentHub-Plan-Id` / `X-AgentHub-Task-Id`。匹配成功时会写入 `artifacts/*.md`，把任务状态置为 `review`，并把 observation prompt 投递回 manager session；manager 不在线时会记录带 task/artifact 上下文的 `delivery_failed`；显式 plan 无法匹配任务时会记录 `unmatched_hook`。task-plan 执行快照事件会保留触发它们的 Collaboration `agent_output` source event id；同一个 source event id 的重复 hook completion 会被忽略，方便后续追踪和去重。当前 workspace 的 hook 处理完成后会刷新 timeline、Task Plans 列表和当前 plan detail。
18. WPF hook pipeline 会优先识别 running conversation 输出；manager supervisor hook 会绕过通用 command dispatcher，交给 conversation orchestrator 投递 delegated prompt 或更新 conversation 状态，避免同一条 `send` 命令被通用 dispatcher 和 conversation orchestrator 重复发送。manager participant hook 如果显式带 `conversationId/taskId`，或可以从最近一次 delegated event 的 `conversationId/taskId/sessionId` 推断上下文，会生成 observation prompt 投回 supervisor。roundtable hook 会按 conversation 的 participant 顺序投递给下一位，到达 `maxSteps` 后完成 conversation。pair negotiation hook 会按两名参与者轮转投递 `continue`，双方接受同一 `proposal_version` 时完成 conversation，达到 `maxSteps` 时暂停。
19. 可以用 Interrupt 向当前 session 发送 Ctrl+C 而不关闭终端；用 Stop selected 停止当前 session，也可以用 Stop all 停止全部 session。
20. 顶部 `Open data` 会打开本机 native 数据目录，方便查看 `workspaces.json`、`settings.json`、`events/` 和 `hooks.jsonl` 等诊断文件。

workspace 列表保存位置：

```text
%LOCALAPPDATA%\AgentHub\Native\workspaces.json
```

协作时间线保存位置：

```text
%LOCALAPPDATA%\AgentHub\Native\events
```

团队 mailbox 保存位置：

```text
<workspace>/.agenthub/teams/<teamId>/mailbox.jsonl
```

legacy task log 保存位置：

```text
<workspace>/.agenthub/tasks/tasks.jsonl
```

native task-plan 执行快照保存位置：
```text
<workspace>/.agenthub/task-plans/YYYY-MM-DD/HHmmss-slug/
```

native task-plan 事件保存位置：
```text
<workspace>/.agenthub/task-plans/native/<planId>/events.jsonl
```

native conversation 状态保存位置：
```text
<workspace>/.agenthub/conversations/conversations.jsonl
```

native Core 已提供 manager conversation 启动切片：创建 conversation 状态、向最新 supervisor session 投递初始 manager prompt，并在缺少 supervisor session 或投递失败时把 conversation 标记为 `failed`。Core 也提供了 manager `handleAgentOutput` 状态流：supervisor 的 `send` / `send_message` 会转成带 conversation/task 上下文的 delegated prompt 并投递到目标 profile 最新 session，`done` 会完成 conversation，`ask_user` 会暂停 conversation；participant 的 hook 回传会生成 observation prompt 投回 supervisor，显式 `conversationId/taskId` 和从最近 delegated event 推断两种路径都支持。Core 还支持 roundtable conversation：按 `claude -> codex -> gemini` 优先顺序规范参与者，启动时投递给第一位，hook 回传后轮转到下一位，到达 `maxSteps` 后完成。Core 也支持两人 pair negotiation conversation：启动时创建 brief/memory/state/turns 文件并投递第一轮文件型协商 prompt，`continue` 会校验或补写当前 turn artifact 后投递给另一位参与者，双方 `accept` 同一 `proposal_version` 后完成，达到 `maxSteps` 时暂停。WPF hook pipeline 已接入这些 conversation 分流逻辑。WPF App 已提供 Conversations 基础入口，可输入 topic 和 participants 后启动 manager、roundtable 或 pair negotiation，并能查看 conversation 列表、详情、打开对应持久化目录，以及暂停、恢复或停止 conversation 编排状态。

Host shell 等本机设置保存位置：

```text
%LOCALAPPDATA%\AgentHub\Native\settings.json
```

Agent hook 诊断日志位置：

```text
%LOCALAPPDATA%\AgentHub\Native\hooks.jsonl
```

## 笔记本 Codex 验证

1. 启动 AgentHub Native。
2. 添加并选择出现滚动问题的项目目录。
3. Host shell 先保持默认 PowerShell。
4. 点击 Resume Codex，直接启动 `codex resume`。
5. 等待 Codex 进入恢复后的 TUI。
6. 验证终端滚动条是否出现。
7. 验证鼠标滚轮 / 触摸板滚动。
8. 从 AgentHub 输入栏发送文本，并验证 Enter 发送、Shift+Enter 换行。
9. 验证 Codex 收到输入。
10. 让 Codex 完成一次响应，确认 Collaboration timeline 列表出现回传。
11. 切换 Host shell 为 cmd 后重复第 4-10 步。

## 注意

- 这是并行原型，不替换现有 Electron app。
- `EasyWindowsTerminalControl` 使用 Windows Terminal 后端包，但仍是第三方封装，不是微软正式稳定的嵌入式 TerminalControl API。
- 当前 target framework 是 `.NET 10`。其他电脑运行前需要安装 .NET 10 Desktop Runtime，或后续改成目标机器已安装的 framework。
