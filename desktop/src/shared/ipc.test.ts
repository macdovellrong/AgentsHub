import { describe, expect, it } from "vitest";
import {
  IpcChannels,
  isSessionErrorEvent,
  isTerminalDataEvent,
  isSessionExitEvent,
  type SessionErrorEvent,
  type TerminalDataEvent,
} from "./ipc";

describe("IPC contract", () => {
  it("uses stable channel names", () => {
    expect(IpcChannels.WorkspaceDefault).toBe("workspace:getDefault");
    expect(IpcChannels.StartPowerShell).toBe("agent:startPowerShell");
    expect(IpcChannels.TerminalData).toBe("terminal:data");
  });

  it("recognizes terminal data events", () => {
    const event: TerminalDataEvent = {
      sessionId: "session-1",
      data: "\u001b[32mready\u001b[0m",
    };

    expect(isTerminalDataEvent(event)).toBe(true);
    expect(isTerminalDataEvent({ sessionId: "session-1" })).toBe(false);
  });

  it("recognizes session exit events", () => {
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: 0 })).toBe(true);
    expect(isSessionExitEvent({ sessionId: "session-1", exitCode: "0" })).toBe(false);
  });

  it("recognizes session error events without a session id", () => {
    const event = {
      message: "failed before session creation",
    } satisfies SessionErrorEvent;

    expect(isSessionErrorEvent(event)).toBe(true);
    expect(isSessionErrorEvent({ sessionId: 123, message: "failed" })).toBe(false);
  });
});
