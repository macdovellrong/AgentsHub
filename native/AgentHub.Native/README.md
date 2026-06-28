# AgentHub Native

这是 C2 方向的 Windows-only 原生原型：AgentHub 保留 Agent session 控制权，同时把终端显示层换成基于 Windows Terminal 后端的 WPF 控件。

## 技术栈

- C# / .NET 10
- WPF
- EasyWindowsTerminalControl
- Windows Terminal backend / ConPTY
- PowerShell 默认 shell host

## 运行

```powershell
cd native/AgentHub.Native
dotnet run --project src/AgentHub.Native.App/AgentHub.Native.App.csproj
```

## 当前流程

1. 启动 native app。
2. 输入 workspace 路径，点击 Add 加入工作区列表。
3. 选中 workspace 后启动 Codex、Claude、Gemini 或普通 PowerShell。
4. 对托管 Agent，app 会安装项目级 `.codex`、`.claude`、`.gemini` hooks。
5. app 会启动本地 hook receiver，并向 PowerShell-hosted session 注入 `AGENTHUB_HOOK_*` 环境变量。
6. 可以用底部输入栏向选中的 terminal session 发送一行文本。
7. 也可以在输入栏左侧选择 `codex`、`claude`、`gemini` 或 `powershell`，按当前 workspace/profile 路由到最新 session。
8. hook 结果会显示在 Collaboration timeline 列表中。
9. 可以用 Stop selected 停止当前 session。

workspace 列表保存在：

```text
%LOCALAPPDATA%\AgentHub\Native\workspaces.json
```

## 笔记本 Codex 验证

```text
1. 启动 AgentHub Native。
2. 添加并选择出现滚动问题的项目目录。
3. 启动 Codex。
4. 进入 resume。
5. 验证终端滚动条是否出现。
6. 验证鼠标滚轮 / 触摸板滚动。
7. 从 AgentHub 输入栏发送一行文本。
8. 验证 Codex 收到输入。
9. 让 Codex 完成一次响应，确认 Collaboration timeline 列表出现回传。
```

## 注意

- 这是并行原型，不替换现有 Electron app。
- `EasyWindowsTerminalControl` 使用 Windows Terminal 后端包，但仍是第三方封装，不是微软正式稳定的嵌入式 TerminalControl API。
- 当前 target framework 是 `.NET 10`。其他电脑运行前需要安装 .NET 10 Desktop Runtime，或者后续改成目标机器已安装的 framework。
