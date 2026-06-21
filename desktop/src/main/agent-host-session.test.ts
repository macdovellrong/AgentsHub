import { describe, expect, it } from "vitest";
import { createAgentHostSession } from "./agent-host-session";

describe("createAgentHostSession", () => {
  it("combines launch metadata, terminal state, and input control", () => {
    const writes: string[] = [];
    const hostSession = createAgentHostSession({
      sessionId: "s1",
      runId: "r1",
      profileId: "codex",
      profileName: "Codex",
      kind: "codex",
      workspacePath: "V:/AgentGroup",
      rawLogPath: "V:/AgentGroup/.agenthub/runs/r1/raw.log",
      metaPath: "V:/AgentGroup/.agenthub/runs/r1/meta.json",
      cols: 80,
      rows: 24,
      hostKind: "powershell",
      write: (data) => writes.push(data),
    });

    hostSession.inputController.markReady();
    hostSession.inputController.write("hello", "user");

    expect(hostSession.session.kind).toBe("codex");
    expect(hostSession.hostKind).toBe("powershell");
    expect(hostSession.terminalState.snapshot().cols).toBe(80);
    expect(hostSession.terminalState.snapshot().inputBytes).toBe(5);
    expect(writes).toEqual(["hello"]);
  });
});
