from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from agenthub.adapters.profiles import AgentProfile
from agenthub.process.interactive_pty import InteractivePtySession
from agenthub.storage.run_index import RunIndexStore
from agenthub.storage.run_logs import RunLogWriter
from agenthub.ui.output_buffer import OutputBuffer


class AgentSessionStatus(StrEnum):
    OFFLINE = "offline"
    STARTING = "starting"
    RUNNING = "running"
    EXITED = "exited"
    STOPPED = "stopped"
    START_FAILED = "start_failed"


@dataclass
class AgentSessionState:
    profile: AgentProfile
    session: InteractivePtySession | None
    output_buffer: OutputBuffer
    log_writer: RunLogWriter | None
    run_index_store: RunIndexStore | None
    run_id: str | None
    status: AgentSessionStatus

    def is_alive(self) -> bool:
        return self.session is not None and self.session.is_alive()


def create_agent_states(
    profiles: tuple[AgentProfile, ...],
) -> dict[str, AgentSessionState]:
    return {
        profile.id: AgentSessionState(
            profile=profile,
            session=None,
            output_buffer=OutputBuffer(max_chars=200_000),
            log_writer=None,
            run_index_store=None,
            run_id=None,
            status=AgentSessionStatus.OFFLINE,
        )
        for profile in profiles
    }
