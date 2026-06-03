from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any, TextIO


DEFAULT_TIMEOUT_SECONDS = 3.0


PostJson = Callable[[str, dict[str, str], dict[str, object], float], None]


def extract_message(source: str, hook_payload: Mapping[str, Any]) -> str:
    if source == "gemini":
        candidates = ("prompt_response", "last_assistant_message", "last_agent_message", "message")
    else:
        candidates = ("last_assistant_message", "last_agent_message", "message", "prompt_response")

    for field in candidates:
        value = hook_payload.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()

    transcript_path = hook_payload.get("transcript_path")
    if isinstance(transcript_path, str) and transcript_path.strip():
        return extract_message_from_transcript(transcript_path)
    return ""


def extract_message_from_transcript(transcript_path: str) -> str:
    try:
        with open(transcript_path, "r", encoding="utf-8", errors="replace") as transcript:
            lines = transcript.readlines()
    except OSError:
        return ""

    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = extract_message_from_transcript_entry(entry)
        if message:
            return message
    return ""


def extract_message_from_transcript_entry(entry: Any) -> str:
    if not isinstance(entry, Mapping):
        return ""

    payload = entry.get("payload")
    if isinstance(payload, Mapping):
        for field in ("last_agent_message", "last_assistant_message", "message"):
            value = payload.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        if payload.get("type") == "message" and payload.get("role") == "assistant":
            return extract_text_content(payload.get("content"))

    message = entry.get("message")
    if isinstance(message, Mapping) and message.get("role") == "assistant":
        return extract_text_content(message.get("content"))

    if entry.get("type") == "assistant":
        return extract_text_content(entry.get("content"))

    return ""


def extract_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, Mapping):
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(part.strip() for part in parts if part.strip()).strip()


def build_agenthub_payload(
    source: str,
    hook_payload: Mapping[str, Any],
    env: Mapping[str, str] | None = None,
) -> dict[str, object] | None:
    env = env or os.environ
    message = extract_message(source, hook_payload)
    if not message:
        return None

    provider_turn_id = hook_payload.get("turn_id")
    if provider_turn_id is None:
        provider_turn_id = hook_payload.get("request_id")

    return sanitize_json_value({
        "source": source,
        "hookEvent": str(hook_payload.get("hook_event_name") or ""),
        "profileId": env.get("AGENTHUB_PROFILE_ID", source),
        "agenthubSessionId": env.get("AGENTHUB_SESSION_ID", ""),
        "runId": env.get("AGENTHUB_RUN_ID", ""),
        "workspace": env.get("AGENTHUB_WORKSPACE", ""),
        "providerSessionId": str(hook_payload.get("session_id") or ""),
        "providerTurnId": str(provider_turn_id or ""),
        "model": str(hook_payload.get("model") or ""),
        "cwd": str(hook_payload.get("cwd") or ""),
        "message": message,
    })


def post_json_with_urllib(
    url: str,
    headers: dict[str, str],
    payload: dict[str, object],
    timeout: float,
) -> None:
    body = json.dumps(sanitize_json_value(payload), ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        response.read()


def run_hook(
    source: str,
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
    env: Mapping[str, str] | None = None,
    post_json: PostJson = post_json_with_urllib,
) -> int:
    env = env or os.environ
    started_at = time.time()
    write_diagnostic(env, {"phase": "start", "source": source})
    try:
        raw_input = read_stdin_text(stdin)
        write_diagnostic(env, {"phase": "stdin_read", "source": source, "bytes": len(raw_input)})
        hook_payload = json.loads(raw_input) if raw_input.strip() else {}
        agenthub_payload = build_agenthub_payload(source, hook_payload, env)

        hook_url = env.get("AGENTHUB_HOOK_URL", "")
        write_diagnostic(
            env,
            {
                "phase": "payload",
                "source": source,
                "hookEvent": str(hook_payload.get("hook_event_name") or ""),
                "hasHookUrl": bool(hook_url),
                "hasHookToken": bool(env.get("AGENTHUB_HOOK_TOKEN", "")),
                "profileId": env.get("AGENTHUB_PROFILE_ID", ""),
                "hasSessionId": bool(env.get("AGENTHUB_SESSION_ID", "")),
                "hasRunId": bool(env.get("AGENTHUB_RUN_ID", "")),
                "workspace": env.get("AGENTHUB_WORKSPACE", ""),
                "hasTranscriptPath": bool(hook_payload.get("transcript_path")),
                "messageChars": len(str(agenthub_payload.get("message", ""))) if agenthub_payload else 0,
            },
        )
        if agenthub_payload and hook_url:
            token = env.get("AGENTHUB_HOOK_TOKEN", "")
            headers = {
                "Content-Type": "application/json; charset=utf-8",
                "X-AgentHub-Token": token,
            }
            timeout = float(env.get("AGENTHUB_HOOK_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
            post_json(hook_url, headers, agenthub_payload, timeout)
            write_diagnostic(
                env,
                {
                    "phase": "post_ok",
                    "source": source,
                    "elapsedMs": int((time.time() - started_at) * 1000),
                },
            )
        elif not agenthub_payload:
            write_diagnostic(env, {"phase": "skip_no_message", "source": source})
        else:
            write_diagnostic(env, {"phase": "skip_no_hook_url", "source": source})
    except Exception as exc:
        write_diagnostic(
            env,
            {
                "phase": "error",
                "source": source,
                "errorType": exc.__class__.__name__,
                "error": str(exc)[:300],
                "elapsedMs": int((time.time() - started_at) * 1000),
            },
        )
        print(f"AgentHub hook error: {exc}", file=stderr)

    stdout.write("{}\n")
    stdout.flush()
    return 0


def read_stdin_text(stdin: TextIO) -> str:
    buffer = getattr(stdin, "buffer", None)
    if buffer is not None:
        raw = buffer.read()
        if isinstance(raw, bytes):
            return raw.decode("utf-8", errors="replace")
        if isinstance(raw, str):
            return raw
    return stdin.read()


def write_diagnostic(env: Mapping[str, str], entry: Mapping[str, object]) -> None:
    log_path = resolve_diagnostic_log_path(env)
    if not log_path:
        return

    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **entry,
    }
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(json.dumps(record, ensure_ascii=False, sort_keys=True))
            log_file.write("\n")
    except OSError:
        return


def resolve_diagnostic_log_path(env: Mapping[str, str]) -> str:
    explicit_path = env.get("AGENTHUB_HOOK_LOG", "")
    if explicit_path:
        return explicit_path

    base_dir = env.get("LOCALAPPDATA") or env.get("APPDATA")
    if not base_dir:
        return ""
    return os.path.join(base_dir, "AgentHub", "hooks.jsonl")


def sanitize_json_value(value: Any) -> Any:
    if isinstance(value, str):
        return replace_unicode_surrogates(value)
    if isinstance(value, Mapping):
        return {str(key): sanitize_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json_value(item) for item in value]
    return value


def replace_unicode_surrogates(value: str) -> str:
    return "".join("\uFFFD" if 0xD800 <= ord(char) <= 0xDFFF else char for char in value)
