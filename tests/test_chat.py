from datetime import datetime

from agenthub.ui.chat import (
    ChatMessage,
    ChatMessageKind,
    format_chat_message,
    new_chat_message,
    parse_routed_input,
)


def test_parse_routed_input_extracts_known_agent_prefix():
    routed = parse_routed_input(
        "@codex implement the parser",
        known_agent_ids={"codex", "claude", "gemini", "powershell"},
        default_agent_id="codex",
    )

    assert routed.target_agent_id == "codex"
    assert routed.text == "implement the parser"
    assert routed.error_message is None


def test_parse_routed_input_uses_default_without_prefix():
    routed = parse_routed_input(
        "run tests",
        known_agent_ids={"codex", "claude"},
        default_agent_id="claude",
    )

    assert routed.target_agent_id == "claude"
    assert routed.text == "run tests"
    assert routed.error_message is None


def test_parse_routed_input_rejects_unknown_agent_prefix():
    routed = parse_routed_input(
        "@reviewer inspect this",
        known_agent_ids={"codex", "gemini"},
        default_agent_id="codex",
    )

    assert routed.target_agent_id is None
    assert routed.text == "inspect this"
    assert routed.error_message == "未知 Agent: reviewer"


def test_parse_routed_input_rejects_empty_message_after_prefix():
    routed = parse_routed_input(
        "@gemini",
        known_agent_ids={"gemini"},
        default_agent_id="gemini",
    )

    assert routed.target_agent_id is None
    assert routed.text == ""
    assert routed.error_message == "消息不能为空"


def test_format_chat_message_includes_sender_and_text():
    message = ChatMessage(
        sender_id="codex",
        sender_name="Codex",
        text="Implemented task 1",
        kind=ChatMessageKind.AGENT,
        timestamp="2026-04-28T10:00:00+08:00",
    )

    assert format_chat_message(message) == (
        "[10:00:00] Codex\nImplemented task 1"
    )


def test_new_chat_message_creates_timestamped_message():
    message = new_chat_message(
        sender_id="user",
        sender_name="You",
        text="run tests",
        kind=ChatMessageKind.USER,
    )

    assert message.sender_id == "user"
    assert message.sender_name == "You"
    assert message.text == "run tests"
    assert message.kind == ChatMessageKind.USER
    assert datetime.fromisoformat(message.timestamp).tzinfo is not None
