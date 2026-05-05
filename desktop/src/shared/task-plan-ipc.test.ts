import { describe, expect, it } from "vitest";
import * as ipc from "./ipc";

describe("task plan IPC contract", () => {
  it("uses stable task plan channel names", () => {
    expect(ipc.IpcChannels.TaskPlanSourcesList).toBe("task-plan-sources:list");
    expect(ipc.IpcChannels.TaskPlansList).toBe("task-plans:list");
    expect(ipc.IpcChannels.TaskPlansCreate).toBe("task-plans:create");
    expect(ipc.IpcChannels.TaskPlansStartManager).toBe("task-plans:startManager");
    expect(ipc.IpcChannels.TaskPlansReadMarkdown).toBe("task-plans:readMarkdown");
    expect(ipc.IpcChannels.TaskPlansOpenFolder).toBe("task-plans:openFolder");
  });

  it("recognizes workspace requests for task plan list", () => {
    expect(ipc.isWorkspaceRequest(undefined)).toBe(true);
    expect(ipc.isWorkspaceRequest({})).toBe(true);
    expect(ipc.isWorkspaceRequest({ workspacePath: "V:/AgentGroup" })).toBe(true);
  });

  it("rejects malformed workspace requests for task plan list", () => {
    expect(ipc.isWorkspaceRequest(null)).toBe(false);
    expect(ipc.isWorkspaceRequest(42)).toBe(false);
    expect(ipc.isWorkspaceRequest([])).toBe(false);
    expect(ipc.isWorkspaceRequest({ workspacePath: 42 })).toBe(false);
  });

  it("recognizes valid create task plan requests", () => {
    expect(
      ipc.isCreateTaskPlanRequest({
        workspacePath: "V:/AgentGroup",
        title: "Implement task plan IPC",
        sourceTaskDirectoryName: "20260504-1330-task-plan-ipc",
        managerProfileId: "claude",
        participantProfileIds: ["codex", "gemini"],
      }),
    ).toBe(true);
    expect(
      ipc.isCreateTaskPlanRequest({
        title: "Implement task plan IPC",
        sourceTaskDirectoryName: "20260504-1330-task-plan-ipc",
        managerProfileId: "claude",
        participantProfileIds: ["codex"],
      }),
    ).toBe(true);
  });

  it("rejects malformed create task plan requests", () => {
    const baseRequest = {
      title: "Implement task plan IPC",
      sourceTaskDirectoryName: "20260504-1330-task-plan-ipc",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    };

    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, workspacePath: 42 })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, title: "" })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, title: "   " })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, sourceTaskDirectoryName: "" })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, sourceTaskDirectoryName: "   " })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, managerProfileId: " " })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, participantProfileIds: [] })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, participantProfileIds: ["codex", " "] })).toBe(false);
    expect(ipc.isCreateTaskPlanRequest({ ...baseRequest, participantProfileIds: "codex" })).toBe(false);
  });

  it("recognizes valid task plan action requests", () => {
    expect(ipc.isTaskPlanActionRequest({ workspacePath: "V:/AgentGroup", planId: "plan-1" })).toBe(true);
    expect(ipc.isTaskPlanActionRequest({ planId: "plan-1" })).toBe(true);
  });

  it("rejects malformed task plan action requests", () => {
    expect(ipc.isTaskPlanActionRequest({ workspacePath: 42, planId: "plan-1" })).toBe(false);
    expect(ipc.isTaskPlanActionRequest({ planId: "" })).toBe(false);
    expect(ipc.isTaskPlanActionRequest({ planId: "   " })).toBe(false);
    expect(ipc.isTaskPlanActionRequest({ planId: 123 })).toBe(false);
  });
});
