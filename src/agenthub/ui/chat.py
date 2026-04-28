from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum


class ChatMessageKind(StrEnum):
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


@dataclass(frozen=True)
class ChatMessage:
    sender_id: str
    sender_name: str
    text: str
    kind: ChatMessageKind
    timestamp: str


@dataclass(frozen=True)
class RoutedInput:
    target_agent_id: str | None
    text: str
    error_message: str | None = None


def parse_routed_input(
    text: str,
    *,
    known_agent_ids: set[str],
    default_agent_id: str,
) -> RoutedInput:
    stripped = text.strip()
    if not stripped:
        return RoutedInput(
            target_agent_id=None,
            text="",
            error_message="消息不能为空",
        )
    if not stripped.startswith("@"):
        return RoutedInput(target_agent_id=default_agent_id, text=stripped)

    route, separator, remainder = stripped.partition(" ")
    target = route[1:].strip().lower()
    message = remainder.strip()
    if target not in known_agent_ids:
        return RoutedInput(
            target_agent_id=None,
            text=message,
            error_message=f"未知 Agent: {target}",
        )
    if not separator or not message:
        return RoutedInput(
            target_agent_id=None,
            text="",
            error_message="消息不能为空",
        )
    return RoutedInput(target_agent_id=target, text=message)


def new_chat_message(
    *,
    sender_id: str,
    sender_name: str,
    text: str,
    kind: ChatMessageKind,
) -> ChatMessage:
    return ChatMessage(
        sender_id=sender_id,
        sender_name=sender_name,
        text=text,
        kind=kind,
        timestamp=datetime.now(timezone.utc).astimezone().isoformat(),
    )


def format_chat_message(message: ChatMessage) -> str:
    timestamp = _format_time(message.timestamp)
    return f"[{timestamp}] {message.sender_name}\n{message.text}"


def _format_time(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%H:%M:%S")
    except ValueError:
        return value
