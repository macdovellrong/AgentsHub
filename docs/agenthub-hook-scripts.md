# AgentHub Hook 脚本接入说明

本文记录 Codex、Claude、Gemini 将最终回复同步回 AgentHub 中央聊天区的 hook 方案。

## 当前策略

AgentHub 不再要求手动把 hook 脚本复制到用户目录。通过 AgentHub 启动 Codex、Claude 或 Gemini 时，主进程会自动把脚本安装到当前工作区：

```text
<workspace>/.codex/hooks/
<workspace>/.claude/hooks/
<workspace>/.gemini/hooks/
```

仓库内的源脚本位于 `scripts/hooks/`：

```text
agenthub_hook_common.py
agenthub_codex_stop.py
agenthub_claude_stop.py
agenthub_gemini_after_agent.py
```

安装到工作区时，每个 CLI 目录只会复制对应入口脚本和 `agenthub_hook_common.py`。

## 自动写入的项目配置

Codex：

```text
<workspace>/.codex/config.toml
<workspace>/.codex/hooks.json
```

AgentHub 会确保 `config.toml` 中启用：

```toml
[features]
codex_hooks = true
```

并在 `hooks.json` 的 `Stop` 事件中追加 AgentHub command hook。

Claude Code：

```text
<workspace>/.claude/settings.local.json
```

AgentHub 会在 `Stop` 和 `StopFailure` 中追加 command hook，调用项目内的 `agenthub_claude_stop.py`。使用 `settings.local.json` 是为了避免把本机路径和实验配置提交到项目仓库。

Gemini CLI：

```text
<workspace>/.gemini/settings.json
```

AgentHub 会在 `AfterAgent` 中追加 command hook，调用项目内的 `agenthub_gemini_after_agent.py`。

## 环境变量

通过 AgentHub 启动的 Agent 会注入以下环境变量：

```text
AGENTHUB_HOOK_URL=http://127.0.0.1:<port>/api/agent-result
AGENTHUB_HOOK_TOKEN=<random-token>
AGENTHUB_PROFILE_ID=<profile-id>
AGENTHUB_SESSION_ID=<agenthub-session-id>
AGENTHUB_RUN_ID=<run-id>
AGENTHUB_WORKSPACE=<workspace-path>
AGENTHUB_TEAM_ID=default
```

hook 脚本依赖这些变量定位回调服务、工作区、会话和 profile。

## 普通终端启动时的行为

项目级配置意味着：如果你在同一个项目目录中直接用 Windows Terminal 启动 `codex`、`claude` 或 `gemini`，CLI 仍然会加载项目 hook。

但脚本会先检查 `AGENTHUB_HOOK_URL`。如果不是通过 AgentHub 启动，没有该变量，脚本只输出 `{}` 并记录诊断日志，不会向任何服务发送消息。

## 配置合并规则

- 自动安装是幂等的，多次启动不会重复插入 AgentHub hook。
- 已存在的 Codex、Claude、Gemini 配置会保留。
- 已存在的非 AgentHub hook 会保留。
- 如果对应 JSON 配置损坏，启动 Agent 会失败并提示配置解析错误，需要先手动修复该项目配置。

## 工作流

```text
用户在 AgentHub 输入 @codex / @claude / @gemini 消息
  -> AgentHub 写入对应 CLI 的 PTY
  -> CLI 执行并生成最终回复
  -> CLI 触发项目级 hook
  -> hook 脚本读取 stdin JSON
  -> hook 脚本 POST 到 AgentHub 本地 HTTP 服务
  -> AgentHub 写入 events.jsonl 并推送到中央聊天区
```

## 官方文档

- Codex hooks: https://developers.openai.com/codex/hooks
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Gemini CLI hooks: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md
