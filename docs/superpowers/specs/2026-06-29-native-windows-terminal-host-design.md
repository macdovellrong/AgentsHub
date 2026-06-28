# Native Windows Terminal Host 设计

## 背景

AgentHub 的目标不是重新实现 shell，而是在一个桌面软件中管理多个项目目录、启动 Codex/Claude/Gemini，并且让 AgentHub 能向指定 Agent 注入输入。Agent 的语义结果继续通过现有 hook 机制回传，终端屏幕只负责人类可见的 TUI 交互。

当前方向收敛为 Windows-only 的 C2：AgentHub 自己成为 Windows 原生风格的终端工作台，用 Windows Terminal/OpenConsole 风格的终端层替换浏览器终端层。默认 shell 是 PowerShell，但 PowerShell 不是终端宿主；终端宿主要负责窗口、滚动、输入、IME、渲染和 ConPTY 连接。

## 目标

- 提供一个 Windows-only 原生 AgentHub 原型。
- 支持打开 workspace，并在 workspace 下启动 Codex、Claude、Gemini 或 PowerShell。
- 内置终端视图尽量复用 Windows Terminal 后端能力，而不是自研完整 ANSI/TUI 渲染器。
- AgentHub 保留输入控制权，可以向指定 Agent session 写入文本和回车。
- 语义通信继续走 hook，不依赖解析终端屏幕内容。
- 第一阶段优先验证 Codex resume 后的滚动、输入和可用性。

## 非目标

- 第一阶段不替换现有 Electron 主线。
- 第一阶段不承诺跨平台；Linux/macOS 以后可用单独实现。
- 第一阶段不完整复刻 Windows Terminal 的 profile、tab、pane、settings UI。
- 第一阶段不从 TUI 屏幕解析 Agent 最终回答。

## 技术选择

第一阶段使用 C#、.NET 10、WPF。当前机器已经安装 Windows Desktop runtime 和 WPF 模板，不需要额外安装 WinUI workload。

终端控件使用 `EasyWindowsTerminalControl`。它是 WPF 控件，基于 Windows Terminal 后端包，能提供比普通文本框或 Web terminal 更接近 Windows Terminal 的行为。长期方向仍是 Windows Terminal/OpenConsole 风格终端宿主；如果该控件不能满足输入注入、多 session 或滚动需求，再评估更底层的 Windows Terminal 源码集成。

相关资料：

- Windows Terminal / OpenConsole: https://github.com/microsoft/terminal
- Windows pseudoconsole / ConPTY: https://learn.microsoft.com/en-us/windows/console/pseudoconsoles
- EasyWindowsTerminalControl: https://github.com/mitchcapper/EasyWindowsTerminalControl

## 架构

```text
AgentHub.Native.App
  -> Workspace UI
  -> Agent session list
  -> Native terminal view
      -> EasyWindowsTerminalControl
      -> Windows Terminal backend / ConPTY

AgentHub.Native.Core
  -> AgentLaunchPlanBuilder
  -> HookEnvironmentBuilder
  -> AgentHookReceiver
  -> ProjectAgentHookInstaller
  -> AgentInputRouter
```

进程链路：

```text
AgentHub Native App
  -> Windows Terminal backend terminal control
      -> ConPTY
          -> powershell.exe
              -> codex / claude / gemini
```

语义消息链路：

```text
codex / claude / gemini
  -> project hook
      -> AgentHub hook receiver
          -> Hook 消息列表 / 后续协作层
```

## 第一阶段验收

- 能构建 native 解决方案。
- Core 层测试覆盖启动计划、PowerShell quoting、hook 环境、hook receiver、hook installer 和输入路由。
- WPF App 能打开窗口并显示 workspace/session 面板。
- WPF App 能通过 Windows Terminal backend control 启动 PowerShell/Codex/Claude/Gemini。
- WPF App 能向选中的 terminal session 注入输入。
- WPF App 能启动本地 hook receiver，并显示 hook 回传消息。
- 在笔记本上人工验证 Codex resume 后滚动行为。

## 风险

- `EasyWindowsTerminalControl` 是第三方封装，不等同于微软正式稳定的可嵌入 TerminalControl API。
- Codex 自身 TUI 对 alternate screen、滚轮和 scrollback 的处理仍可能影响最终滚动行为；新架构只能减少 xterm.js 变量，不能保证 Codex CLI 本身没有问题。
- 当前原型使用 .NET 10；如果目标机器没有 .NET 10 Desktop Runtime，需要安装 runtime 或后续调整 target framework。
