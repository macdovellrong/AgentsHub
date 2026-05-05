from __future__ import annotations

import io
import json
import sys
from pathlib import Path


HOOKS_DIR = Path(__file__).resolve().parents[1] / "scripts" / "hooks"
sys.path.insert(0, str(HOOKS_DIR))

from agenthub_hook_common import build_agenthub_payload, run_hook  # noqa: E402


def test_codex_payload_uses_last_assistant_message() -> None:
    payload = build_agenthub_payload(
        "codex",
        {
            "hook_event_name": "Stop",
            "session_id": "codex-session",
            "turn_id": "turn-1",
            "model": "gpt-5.3-codex",
            "cwd": "V:\\AgentGroup",
            "last_assistant_message": "已完成修改。",
        },
        {
            "AGENTHUB_PROFILE_ID": "codex-backend",
            "AGENTHUB_SESSION_ID": "agenthub-session",
            "AGENTHUB_RUN_ID": "run-1",
            "AGENTHUB_WORKSPACE": "V:\\AgentGroup",
        },
    )

    assert payload == {
        "source": "codex",
        "hookEvent": "Stop",
        "profileId": "codex-backend",
        "agenthubSessionId": "agenthub-session",
        "runId": "run-1",
        "workspace": "V:\\AgentGroup",
        "providerSessionId": "codex-session",
        "providerTurnId": "turn-1",
        "model": "gpt-5.3-codex",
        "cwd": "V:\\AgentGroup",
        "message": "已完成修改。",
    }


def test_codex_payload_accepts_last_agent_message_alias() -> None:
    payload = build_agenthub_payload(
        "codex",
        {
            "hook_event_name": "Stop",
            "session_id": "codex-session",
            "turn_id": "turn-1",
            "last_agent_message": "别名字段里的最终回复。",
        },
        {
            "AGENTHUB_PROFILE_ID": "codex",
        },
    )

    assert payload is not None
    assert payload["message"] == "别名字段里的最终回复。"


def test_payload_falls_back_to_codex_transcript(tmp_path: Path) -> None:
    transcript_path = tmp_path / "codex.jsonl"
    transcript_path.write_text(
        "\n".join(
            [
                json.dumps({"type": "response_item", "payload": {"type": "message", "role": "user", "content": []}}),
                json.dumps(
                    {
                        "type": "event_msg",
                        "payload": {
                            "type": "task_complete",
                            "last_agent_message": "从 transcript 解析到的最终回复。",
                        },
                    },
                    ensure_ascii=False,
                ),
            ]
        ),
        encoding="utf-8",
    )

    payload = build_agenthub_payload(
        "codex",
        {
            "hook_event_name": "Stop",
            "session_id": "codex-session",
            "transcript_path": str(transcript_path),
        },
        {"AGENTHUB_PROFILE_ID": "codex"},
    )

    assert payload is not None
    assert payload["message"] == "从 transcript 解析到的最终回复。"


def test_claude_payload_uses_last_assistant_message() -> None:
    payload = build_agenthub_payload(
        "claude",
        {
            "hook_event_name": "Stop",
            "session_id": "claude-session",
            "transcript_path": "C:\\Users\\saber\\.claude\\projects\\session.jsonl",
            "cwd": "V:\\AgentGroup",
            "last_assistant_message": "Claude 完成了审查。",
        },
        {"AGENTHUB_PROFILE_ID": "claude-reviewer"},
    )

    assert payload is not None
    assert payload["source"] == "claude"
    assert payload["profileId"] == "claude-reviewer"
    assert payload["providerSessionId"] == "claude-session"
    assert payload["message"] == "Claude 完成了审查。"


def test_claude_payload_falls_back_to_transcript(tmp_path: Path) -> None:
    transcript_path = tmp_path / "claude.jsonl"
    transcript_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "type": "assistant",
                        "message": {
                            "role": "assistant",
                            "content": [{"type": "text", "text": "Claude transcript result"}],
                        },
                    }
                ),
            ]
        ),
        encoding="utf-8",
    )

    payload = build_agenthub_payload(
        "claude",
        {
            "hook_event_name": "StopFailure",
            "session_id": "claude-session",
            "transcript_path": str(transcript_path),
        },
        {"AGENTHUB_PROFILE_ID": "claude"},
    )

    assert payload is not None
    assert payload["hookEvent"] == "StopFailure"
    assert payload["message"] == "Claude transcript result"


def test_gemini_payload_uses_prompt_response() -> None:
    payload = build_agenthub_payload(
        "gemini",
        {
            "hook_event_name": "AfterAgent",
            "session_id": "gemini-session",
            "cwd": "V:\\AgentGroup",
            "prompt": "review",
            "prompt_response": "Gemini review 通过。",
        },
        {"AGENTHUB_PROFILE_ID": "gemini-reviewer"},
    )

    assert payload is not None
    assert payload["source"] == "gemini"
    assert payload["hookEvent"] == "AfterAgent"
    assert payload["providerSessionId"] == "gemini-session"
    assert payload["message"] == "Gemini review 通过。"


def test_gemini_payload_replaces_unicode_surrogates() -> None:
    payload = build_agenthub_payload(
        "gemini",
        {
            "hook_event_name": "AfterAgent",
            "session_id": "gemini-session",
            "cwd": "V:\\AgentGroup",
            "prompt_response": "Gemini ok \udcaf done",
        },
        {"AGENTHUB_PROFILE_ID": "gemini"},
    )

    assert payload is not None
    assert payload["message"] == "Gemini ok � done"
    json.dumps(payload, ensure_ascii=False).encode("utf-8")


def test_run_hook_reads_binary_stdin_as_utf8_on_windows() -> None:
    raw_bytes = json.dumps(
        {
            "hook_event_name": "AfterAgent",
            "session_id": "gemini-session",
            "prompt_response": "测试正常",
        },
        ensure_ascii=False,
    ).encode("utf-8")

    class WindowsTextStdin:
        def __init__(self, data: bytes) -> None:
            self.buffer = io.BytesIO(data)

        def read(self) -> str:
            return raw_bytes.decode("cp936", errors="replace")

    requests: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def fake_post(url: str, headers: dict[str, str], payload: dict[str, object], timeout: float) -> None:
        requests.append((url, headers, payload))

    exit_code = run_hook(
        "gemini",
        stdin=WindowsTextStdin(raw_bytes),  # type: ignore[arg-type]
        stdout=io.StringIO(),
        stderr=io.StringIO(),
        env={
            "AGENTHUB_HOOK_URL": "http://127.0.0.1:38765/api/agent-result",
            "AGENTHUB_HOOK_TOKEN": "secret",
            "AGENTHUB_PROFILE_ID": "gemini",
        },
        post_json=fake_post,
    )

    assert exit_code == 0
    assert len(requests) == 1
    assert requests[0][2]["message"] == "测试正常"


def test_run_hook_posts_payload_and_writes_json_stdout() -> None:
    requests: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def fake_post(url: str, headers: dict[str, str], payload: dict[str, object], timeout: float) -> None:
        requests.append((url, headers, payload))
        assert timeout == 3.0

    stdout = io.StringIO()
    stderr = io.StringIO()

    exit_code = run_hook(
        "codex",
        stdin=io.StringIO(
            json.dumps(
                {
                    "hook_event_name": "Stop",
                    "session_id": "codex-session",
                    "last_assistant_message": "结果消息",
                }
            )
        ),
        stdout=stdout,
        stderr=stderr,
        env={
            "AGENTHUB_HOOK_URL": "http://127.0.0.1:38765/api/agent-result",
            "AGENTHUB_HOOK_TOKEN": "secret",
            "AGENTHUB_PROFILE_ID": "codex",
        },
        post_json=fake_post,
    )

    assert exit_code == 0
    assert stdout.getvalue() == "{}\n"
    assert stderr.getvalue() == ""
    assert len(requests) == 1
    assert requests[0][0] == "http://127.0.0.1:38765/api/agent-result"
    assert requests[0][1]["X-AgentHub-Token"] == "secret"
    assert requests[0][2]["message"] == "结果消息"
