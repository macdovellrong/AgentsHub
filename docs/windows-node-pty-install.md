# Windows 新电脑安装 AgentHub 的 node-pty 注意事项

本文记录在新 Windows 电脑上运行 AgentHub 时，`npm install` 可能因为
`node-pty` 安装失败而中断的原因和处理方式。适用于使用
`.\start-agenthub.bat`、`cd desktop; npm install` 或首次安装依赖的场景。

## 背景

AgentHub 的桌面主线位于 `desktop/`，使用 Electron、React、xterm.js 和
`node-pty`。

其中：

- `xterm.js` 负责在界面里显示终端。
- `node-pty` 负责在后台真正启动 PowerShell、Codex、Claude、Gemini 等命令行进程。

`node-pty` 不是纯 JavaScript 包，它包含 Windows 原生模块。首次安装时，如果没有可用的预编译模块，它会调用 `node-gyp` 在本机编译。

Windows 上编译 `node-pty` 通常需要：

- Node.js / npm
- Python 3.11 或 3.12
- Visual Studio Build Tools C++ 工具链

## 常见失败 1：PowerShell 5 不支持 `||`

`node-pty` 的安装脚本包含类似下面的命令：

```text
node scripts/prebuild.js || node-gyp rebuild
```

这里的 `||` 表示“左边失败时执行右边”。这是 `cmd.exe`、bash 等 shell 常见的语法。

Windows PowerShell 5.1 不支持这种写法，所以如果 npm 使用 PowerShell 5.1 来执行依赖包脚本，可能报错：

```text
"||" is not a valid statement separator in this version.
```

注意：这不表示用户不能继续使用 PowerShell。这里说的是 npm 内部执行依赖安装脚本时使用的 shell，不是用户日常打开的 Windows Terminal。

推荐在新电脑上设置用户级 npm script shell：

```powershell
npm.cmd config set script-shell "C:\Windows\System32\cmd.exe" --location=user
```

这样仍然可以在 PowerShell 里运行：

```powershell
cd D:\AgentsHub\AgentsHub\desktop
npm.cmd install
npm.cmd run dev
```

只是 npm 在执行依赖包自己的 `install` / `postinstall` 脚本时，会用 `cmd.exe` 解释脚本字符串。

## 常见失败 2：Python 3.14 缺少 distutils

`node-gyp` 编译原生模块时会调用 Python。

如果系统默认 `python` 指向 Python 3.14，可能报错：

```text
ModuleNotFoundError: No module named 'distutils'
```

这是因为 Python 3.14 不再提供 `distutils`，而当前 `node-gyp` 相关流程仍可能依赖它。

推荐安装并固定使用 Python 3.11 或 Python 3.12。已验证 Python 3.11 可用。

例如安装 Python 3.11 后，设置：

```powershell
npm.cmd config set python "C:\Python311\python.exe" --location=user
```

如果安装的是 Python 3.12，例如路径为 `C:\Program Files\Python312\python.exe`，则设置：

```powershell
npm.cmd config set python "C:\Program Files\Python312\python.exe" --location=user
```

不要只依赖 PATH 顺序。显式设置 npm 的 `python` 更稳定。

## 推荐的新电脑配置步骤

在新 Windows 电脑上，首次运行 AgentHub 前建议执行：

```powershell
npm.cmd config set script-shell "C:\Windows\System32\cmd.exe" --location=user
npm.cmd config set python "C:\Python311\python.exe" --location=user
```

如果 Python 3.11 安装路径不同，先查询：

```powershell
py -0p
where.exe python
```

然后把实际路径写入 npm 配置。

检查配置：

```powershell
npm.cmd config get script-shell --location=user
npm.cmd config get python --location=user
```

期望类似：

```text
C:\Windows\System32\cmd.exe
C:\Python311\python.exe
```

然后安装依赖：

```powershell
cd D:\AgentsHub\AgentsHub\desktop
npm.cmd install
```

验证 `node-pty` 原生模块是否安装成功：

```powershell
Test-Path .\node_modules\node-pty\build\Release\pty.node
```

输出 `True` 表示安装成功。

## 如果之前临时改过项目文件

排查时可能临时改过 `desktop/.npmrc`。如果要求项目代码保持不变，应还原它：

```powershell
cd D:\AgentsHub\AgentsHub
git checkout -- desktop\.npmrc
git status --short
```

`git status --short` 不应再显示：

```text
M desktop/.npmrc
```

## 说明：为什么家里电脑能用，新电脑失败

家里电脑可能已经存在：

```text
desktop\node_modules\
desktop\node_modules\node-pty\build\Release\pty.node
```

`start-agenthub.bat` 只有在 `desktop\node_modules` 不存在时才会运行 `npm install`。因此家里电脑可能没有重新触发 `node-pty` 的安装/编译流程。

新电脑首次安装时必须完整运行 `node-pty` 安装脚本，所以更容易暴露：

- npm script shell 使用 PowerShell 5.1，无法解析 `||`
- node-gyp 选中 Python 3.14，缺少 `distutils`

## 最终建议

新 Windows 电脑建议固定：

```text
npm script-shell = C:\Windows\System32\cmd.exe
npm python       = Python 3.11 或 Python 3.12 的 python.exe
```

用户日常仍然可以使用 PowerShell，不需要把 Windows Terminal 默认 shell 改成 cmd。
