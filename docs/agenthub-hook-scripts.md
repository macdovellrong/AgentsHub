# AgentHub Hook 脚本接入说明

本文记录 Codex、Claude、Gemini 将最终回复同步回 AgentHub 中央聊天区的 hook 脚本方案。

## 当前脚本

仓库内脚本位于：

```text
scripts/hooks/agenthub_hook_common.py
scripts/hooks/agenthub_codex_stop.py
scripts/hooks/agenthub_claude_stop.py
scripts/hooks/agenthub_gemini_after_agent.py
```

三个入口脚本共用 `agenthub_hook_common.py`。脚本会读取 CLI hook 传入的 `stdin` JSON，抽取最终回复，然后通过 HTTP POST 发送到 AgentHub 本地服务。

## 推荐系统放置位置

建议把 `scripts/hooks/` 下的 4 个 `.py` 文件复制到：

```text
C:\Users\saber\.agenthub\hooks\
```

不要只复制入口脚本，因为它们依赖同目录下的 `agenthub_hook_common.py`。

## AgentHub 注入的环境变量

AgentHub 启动每个 Agent 进程时，应注入以下环境变量：

```text
AGENTHUB_HOOK_URL=http://127.0.0.1:<port>/api/agent-result
AGENTHUB_HOOK_TOKEN=<random-token>
AGENTHUB_PROFILE_ID=<profile-id>
AGENTHUB_SESSION_ID=<agenthub-session-id>
AGENTHUB_RUN_ID=<run-id>
AGENTHUB_WORKSPACE=<workspace-path>
```

这些变量用于区分多个 Codex、Claude、Gemini 实例，避免所有 hook 结果混到同一个聊天流里。

## Codex 配置

用户级配置位置：

```text
C:\Users\saber\.codex\config.toml
C:\Users\saber\.codex\hooks.json
```

项目级配置位置：

```text
<workspace>\.codex\config.toml
<workspace>\.codex\hooks.json
```

`config.toml` 需要开启 hooks：

```toml
[features]
codex_hooks = true
```

`hooks.json` 示例：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "py -3 \"C:\\Users\\saber\\.agenthub\\hooks\\agenthub_codex_stop.py\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Codex 使用 `Stop` hook，在一轮回复结束后发送 `last_assistant_message`。

## Claude 配置

用户级配置位置：

```text
C:\Users\saber\.claude\settings.json
```

项目级配置位置：

```text
<workspace>\.claude\settings.json
<workspace>\.claude\settings.local.json
```

Claude 推荐使用原生 HTTP hook，直接 POST 到 AgentHub 本地服务，避免再启动一层 Python 转发进程。配置示例：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:38765/api/agent-result",
            "timeout": 5,
            "headers": {
              "X-AgentHub-Token": "$AGENTHUB_HOOK_TOKEN",
              "X-AgentHub-Source": "claude",
              "X-AgentHub-Profile-Id": "$AGENTHUB_PROFILE_ID",
              "X-AgentHub-Session-Id": "$AGENTHUB_SESSION_ID",
              "X-AgentHub-Run-Id": "$AGENTHUB_RUN_ID",
              "X-AgentHub-Workspace": "$AGENTHUB_WORKSPACE"
            },
            "allowedEnvVars": [
              "AGENTHUB_HOOK_TOKEN",
              "AGENTHUB_PROFILE_ID",
              "AGENTHUB_SESSION_ID",
              "AGENTHUB_RUN_ID",
              "AGENTHUB_WORKSPACE"
            ]
          }
        ]
      }
    ]
  }
}
```

Claude 使用 `Stop` hook，在一轮正常回复结束后发送最终助手消息。如果一轮因为 API 错误结束，Claude 会触发 `StopFailure` 而不是 `Stop`，因此建议同时配置同样的 HTTP hook：

```json
{
  "hooks": {
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:38765/api/agent-result",
            "timeout": 5,
            "headers": {
              "X-AgentHub-Token": "$AGENTHUB_HOOK_TOKEN",
              "X-AgentHub-Source": "claude",
              "X-AgentHub-Profile-Id": "$AGENTHUB_PROFILE_ID",
              "X-AgentHub-Session-Id": "$AGENTHUB_SESSION_ID",
              "X-AgentHub-Run-Id": "$AGENTHUB_RUN_ID",
              "X-AgentHub-Workspace": "$AGENTHUB_WORKSPACE"
            },
            "allowedEnvVars": [
              "AGENTHUB_HOOK_TOKEN",
              "AGENTHUB_PROFILE_ID",
              "AGENTHUB_SESSION_ID",
              "AGENTHUB_RUN_ID",
              "AGENTHUB_WORKSPACE"
            ]
          }
        ]
      }
    ]
  }
}
```

## Gemini 配置

用户级配置位置：

```text
C:\Users\saber\.gemini\settings.json
```

项目级配置位置：

```text
<workspace>\.gemini\settings.json
```

系统级配置位置：

```text
C:\ProgramData\gemini-cli\settings.json
```

配置示例：

```json
{
  "hooks": {
    "AfterAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "name": "agenthub-result",
            "type": "command",
            "command": "py -3 \"C:\\Users\\saber\\.agenthub\\hooks\\agenthub_gemini_after_agent.py\"",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

Gemini 使用 `AfterAgent` hook，在一轮 agent 执行结束后发送 `prompt_response`。

## 工作流

```text
用户在 AgentHub 输入 @codex / @claude / @gemini 消息
        ↓
AgentHub 写入对应 CLI 的 PTY
        ↓
CLI 执行任务并生成最终回复
        ↓
CLI 触发 hook 脚本
        ↓
hook 脚本读取 stdin JSON
        ↓
hook 脚本 POST 到 AgentHub 本地 HTTP 服务
        ↓
AgentHub 写入 events.jsonl 并推送到中央聊天区
```

## 注意事项

- 第一版建议使用用户级配置，避免每个 workspace 重复配置。
- AgentHub 未启动或未注入 `AGENTHUB_HOOK_URL` 时，脚本只输出 `{}`，不会发送消息。
- hook 脚本 stdout 应保持 JSON 输出，普通日志应写入 stderr，避免破坏 CLI hook 协议。
- 回调服务建议只监听 `127.0.0.1`，并校验 `X-AgentHub-Token`。

## 官方文档

- Codex hooks: https://developers.openai.com/codex/hooks
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Gemini CLI hooks: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md
