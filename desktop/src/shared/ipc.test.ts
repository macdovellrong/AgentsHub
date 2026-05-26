import { describe, expect, it } from "vitest";
import {
  IpcChannels,
  isConversationActionRequest,
  isStartManagerConversationRequest,
  isStartPairNegotiationConversationRequest,
  isStartRoundtableConversationRequest,
  isEventAppendedEvent,
  isSessionErrorEvent,
  isTerminalAckRequest,
  isTerminalDataEvent,
  isSessionExitEvent,
  type SessionErrorEvent,
  type TerminalAckRequest,
  type TerminalDataEvent,
} from "./ipc";

describe("IPC contract", () => {
  it("uses stable channel names", () => {
    expect(IpcChannels.WorkspaceDefault).toBe("workspace:getDefault");
    expect(IpcChannels.WorkspaceDelete).toBe("workspace:delete");
    expect(IpcChannels.WorkspaceOpenFolder).toBe("workspace:openFolder");
    expect(IpcChannels.StartPowerShell).toBe("agent:startPowerShell");
    expect(IpcChannels.TerminalData).toBe("terminal:data");
    expect(IpcChannels.TerminalAck).toBe("terminal:ack");
    expect(IpcChannels.EventAppended).toBe("events:appended");
    expect(IpcChannels.ConversationsList).toBe("conversations:list");
    expect(IpcChannels.ConversationsStartManager).toBe("conversations:startManager");
    expect(IpcChannels.ConversationsStartRoundtable).toBe("conversations:startRoundtable");
    expect(IpcChannels.ConversationsStartPairNegotiation).toBe("conversations:startPairNegotiation");
    expect(IpcChannels.ConversationsPause).toBe("conversations:pause");
    expect(IpcChannels.ConversationsResume).toBe("conversations:resume");
    expect(IpcChannels.ConversationsStop).toBe("conversations:stop");
    expect(IpcChannels.ClipboardReadText).toBe("clipboard:readText");
    expect(IpcChannels.ClipboardWriteText).toBe("clipboard:writeText");
    expect(IpcChannels.AttachmentsSaveClipboardImage).toBe("attachments:saveClipboardImage");
  });

  it("recognizes terminal data events", () => {
    const event: TerminalDataEvent = {
      sessionId: "session-1",
      data: "\u001b[32mready\u001b[0m",
      seq: 1,
      byteLength: 18,
    };

    expect(isTerminalDataEvent(event)).toBe(true);
    expect(isTerminalDataEvent({ sessionId: "session-1" })).toBe(false);
    expect(isTerminalDataEvent({ sessionId: "session-1", data: "ready", seq: 1, byteLength: "5" })).toBe(false);
    expect(isTerminalDataEvent({ sessionId: "session-1", data: "ready", seq: 0, byteLength: 5 })).toBe(false);
  });

  it("recognizes terminal ACK requests", () => {
    const request: TerminalAckRequest = {
      sessionId: "session-1",
      byteLength: 128,
    };

    expect(isTerminalAckRequest(request)).toBe(true);
    expect(isTerminalAckRequest({ sessionId: "session-1", byteLength: 0 })).toBe(false);
    expect(isTerminalAckRequest({ sessionId: "session-1", byteLength: Number.NaN })).toBe(false);
    expect(isTerminalAckRequest({ sessionId: 42, byteLength: 128 })).toBe(false);
  });

  it("recognizes session exit events", () => {
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: 0 })).toBe(true);
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: "0" })).toBe(false);
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: Number.NaN })).toBe(false);
  });

  it("recognizes session error events without a session id", () => {
    const event = {
      message: "failed before session creation",
    } satisfies SessionErrorEvent;

    expect(isSessionErrorEvent(event)).toBe(true);
    expect(isSessionErrorEvent({ sessionId: 123, message: "failed" })).toBe(false);
  });

  it("recognizes appended event notifications", () => {
    expect(
      isEventAppendedEvent({
        workspacePath: "V:/AgentGroup",
        event: {
          id: "event-1",
          type: "agent_output",
          timestamp: "2026-05-01T00:00:00.000Z",
          message: "done",
        },
      }),
    ).toBe(true);
    expect(isEventAppendedEvent({ workspacePath: "V:/AgentGroup", event: { type: "agent_output" } })).toBe(false);
  });

  it("recognizes appended event notifications with conversation metadata", () => {
    expect(
      isEventAppendedEvent({
        workspacePath: "V:/AgentGroup",
        event: {
          id: "event-1",
          type: "agent_forward",
          timestamp: "2026-05-02T00:00:00.000Z",
          message: "Implement task 1",
          conversationId: "conversation-1",
          taskId: "task-1",
          parentEventId: "event-parent",
          targetProfileIds: ["codex", "gemini"],
          deliveryStatus: "pending",
        },
      }),
    ).toBe(true);

    expect(
      isEventAppendedEvent({
        workspacePath: "V:/AgentGroup",
        event: {
          id: "event-1",
          type: "agent_forward",
          timestamp: "2026-05-02T00:00:00.000Z",
          conversationId: "conversation-1",
          targetProfileIds: ["codex", 42],
        },
      }),
    ).toBe(false);

    expect(
      isEventAppendedEvent({
        workspacePath: "V:/AgentGroup",
        event: {
          id: "event-1",
          type: "agent_forward",
          timestamp: "2026-05-02T00:00:00.000Z",
          conversationId: "conversation-1",
          deliveryStatus: "delivered",
        },
      }),
    ).toBe(false);
  });

  it("rejects appended event notifications with malformed event fields", () => {
    const baseNotification = {
      workspacePath: "V:/AgentGroup",
      event: {
        id: "event-1",
        type: "agent_output",
        timestamp: "2026-05-02T00:00:00.000Z",
      },
    };

    expect(isEventAppendedEvent({ ...baseNotification, event: { ...baseNotification.event, type: "not_real" } })).toBe(false);
    expect(isEventAppendedEvent({ ...baseNotification, event: { ...baseNotification.event, message: 123 } })).toBe(false);
    expect(isEventAppendedEvent({ ...baseNotification, event: { ...baseNotification.event, targetProfileId: 123 } })).toBe(false);
    expect(isEventAppendedEvent({ ...baseNotification, event: { ...baseNotification.event, exitCode: "0" } })).toBe(false);
    expect(isEventAppendedEvent({ ...baseNotification, event: { ...baseNotification.event, exitCode: Number.NaN } })).toBe(false);
    expect(isEventAppendedEvent({ ...baseNotification, event: { ...baseNotification.event, metadata: "bad" } })).toBe(false);
  });

  it("recognizes start manager conversation requests", () => {
    expect(
      isStartManagerConversationRequest({
        workspacePath: "V:/AgentGroup",
        topic: "Implement feature list",
        supervisorProfileId: "claude",
        participantProfileIds: ["codex", "gemini"],
        maxSteps: 12,
      }),
    ).toBe(true);
    expect(isStartManagerConversationRequest({ topic: "", participantProfileIds: ["codex"] })).toBe(false);
    expect(isStartManagerConversationRequest({ topic: "x", participantProfileIds: "codex" })).toBe(false);
    expect(isStartManagerConversationRequest({ topic: "x", participantProfileIds: ["codex"], maxSteps: Number.NaN })).toBe(false);
  });

  it("recognizes start roundtable conversation requests", () => {
    expect(
      isStartRoundtableConversationRequest({
        workspacePath: "V:/AgentGroup",
        topic: "Discuss architecture",
        participantProfileIds: ["claude", "codex", "gemini"],
        maxRounds: 2,
      }),
    ).toBe(true);
    expect(isStartRoundtableConversationRequest({ topic: "", participantProfileIds: ["codex"] })).toBe(false);
    expect(isStartRoundtableConversationRequest({ topic: "x", participantProfileIds: [] })).toBe(false);
    expect(isStartRoundtableConversationRequest({ topic: "x", participantProfileIds: ["codex"], maxRounds: 0 })).toBe(false);
  });

  it("recognizes start pair negotiation conversation requests", () => {
    expect(
      isStartPairNegotiationConversationRequest({
        workspacePath: "V:/AgentGroup",
        topic: "Agree on a design",
        participantProfileIds: ["claude", "codex"],
        maxRounds: 3,
      }),
    ).toBe(true);
    expect(isStartPairNegotiationConversationRequest({ topic: "", participantProfileIds: ["claude", "codex"] })).toBe(false);
    expect(isStartPairNegotiationConversationRequest({ topic: "x", participantProfileIds: ["claude"] })).toBe(false);
    expect(isStartPairNegotiationConversationRequest({ topic: "x", participantProfileIds: ["claude", "codex", "gemini"] })).toBe(false);
    expect(isStartPairNegotiationConversationRequest({ topic: "x", participantProfileIds: ["claude", "codex"], maxRounds: 0 })).toBe(false);
  });

  it("recognizes conversation action requests", () => {
    expect(isConversationActionRequest({ workspacePath: "V:/AgentGroup", conversationId: "conversation-1" })).toBe(true);
    expect(isConversationActionRequest({ conversationId: "" })).toBe(false);
    expect(isConversationActionRequest({ conversationId: 123 })).toBe(false);
  });
});
