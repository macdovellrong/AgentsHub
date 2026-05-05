import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskPlanStore, type TaskPlanEventInput, type TaskPlanTask } from "./task-plan-store";

let workspacePath: string | undefined;
let outsidePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
  if (outsidePath) {
    await rm(outsidePath, { recursive: true, force: true });
    outsidePath = undefined;
  }
});

describe("TaskPlanStore", () => {
  it("lists project task sources from workspace tasks directories", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const firstPlanPath = await writeTaskSource(workspacePath, "20260504-1330-ui-refactor", "# UI Refactor\n\n- [ ] Work");
    await writeTaskSource(workspacePath, "20260504-1400-hook-fix", "No heading\n\n- [ ] Fix hook");
    await mkdir(path.join(workspacePath, "tasks", "20260504-1500-empty-dir"), { recursive: true });

    await expect(store.listSourceTasks(workspacePath)).resolves.toEqual([
      {
        directoryName: "20260504-1330-ui-refactor",
        title: "UI Refactor",
        taskDir: path.join(workspacePath, "tasks", "20260504-1330-ui-refactor"),
        sourcePlanPath: firstPlanPath,
      },
      {
        directoryName: "20260504-1400-hook-fix",
        title: "20260504-1400-hook-fix",
        taskDir: path.join(workspacePath, "tasks", "20260504-1400-hook-fix"),
        sourcePlanPath: path.join(workspacePath, "tasks", "20260504-1400-hook-fix", "task-plan.md"),
      },
    ]);
  });

  it("creates a dated task plan directory by snapshotting the selected tasks directory task-plan.md file", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({
      now: () => new Date("2026-05-04T13:30:12.000Z"),
    });
    const sourcePlanPath = await writeTaskSource(workspacePath, "20260504-1330-agenthub-ui", "# Tasks\n\n- [ ] Refactor UI");
    const sourceTaskDir = path.dirname(sourcePlanPath);

    const plan = await store.createPlan(workspacePath, {
      title: "AgentHub UI Refactor",
      sourceTaskDirectoryName: "20260504-1330-agenthub-ui",
      managerProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
    });

    const expectedPlanPath = path.join(
      workspacePath,
      ".agenthub",
      "task-plans",
      "2026-05-04",
      "133012-agenthub-ui-refactor",
    );
    expect(plan).toMatchObject({
      id: "20260504-133012-agenthub-ui-refactor",
      title: "AgentHub UI Refactor",
      status: "draft",
      managerProfileId: "claude",
      participantProfileIds: ["codex", "gemini"],
      date: "2026-05-04",
      directoryName: "133012-agenthub-ui-refactor",
      planPath: expectedPlanPath,
      sourceTaskDir,
      sourcePlanPath,
      createdAt: "2026-05-04T13:30:12.000Z",
      updatedAt: "2026-05-04T13:30:12.000Z",
    });

    const planJson = JSON.parse(await readFile(path.join(plan.planPath, "plan.json"), "utf8")) as unknown;
    expect(planJson).toEqual(plan);
    await expect(readFile(path.join(plan.planPath, "task-plan.md"), "utf8")).resolves.toBe(
      "# Tasks\n\n- [ ] Refactor UI",
    );
    await expect(readFile(path.join(plan.planPath, "tasks.jsonl"), "utf8")).resolves.toBe("");
    await expect(readFile(path.join(plan.planPath, "events.jsonl"), "utf8")).resolves.toBe("");
    expect((await stat(path.join(plan.planPath, "artifacts"))).isDirectory()).toBe(true);

    await writeFile(sourcePlanPath, "# Tasks\n\n- [x] Changed after snapshot", "utf8");
    await expect(store.listPlans(workspacePath)).resolves.toEqual([plan]);
    await expect(store.getPlan(workspacePath, plan.id)).resolves.toEqual(plan);
    await expect(store.readMarkdown(workspacePath, plan.id)).resolves.toBe("# Tasks\n\n- [ ] Refactor UI");
  });

  it("rejects creating a task plan when the project task-plan.md file is missing or empty", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const input = {
      title: "Missing Plan",
      sourceTaskDirectoryName: "20260504-1330-missing",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    };

    await expect(store.createPlan(workspacePath, input)).rejects.toThrow("Task source task-plan.md not found");

    await writeTaskSource(workspacePath, "20260504-1330-missing", "  \r\n");

    await expect(store.createPlan(workspacePath, input)).rejects.toThrow("Task source task-plan.md is empty");
  });

  it("rejects source task directory names that escape the workspace tasks folder", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    const input = {
      title: "Unsafe Plan",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    };

    await expect(store.createPlan(workspacePath, { ...input, sourceTaskDirectoryName: "../escape" })).rejects.toThrow(
      "Invalid task source directory",
    );
    await expect(store.createPlan(workspacePath, { ...input, sourceTaskDirectoryName: "nested/source" })).rejects.toThrow(
      "Invalid task source directory",
    );
  });

  it("appends tasks, events, and artifacts inside the selected plan directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-hook-work", "# Hook Work");
    const plan = await store.createPlan(workspacePath, {
      title: "Hook Work",
      sourceTaskDirectoryName: "20260504-1330-hook-work",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    const task: TaskPlanTask = {
      id: "T001",
      title: "Implement hook",
      status: "pending",
      assigneeProfileId: "codex",
      attempt: 0,
    };
    const event: TaskPlanEventInput = {
      type: "assigned",
      taskId: "T001",
      fromProfileId: "claude",
      toProfileId: "codex",
      message: "Implement hook",
    };
    await store.appendTask(workspacePath, plan.id, task);
    const storedEvent = await store.appendEvent(workspacePath, plan.id, event);
    const artifact = await store.writeArtifact(workspacePath, plan.id, "T001-codex-result.md", "Done");

    await expect(store.listTasks(workspacePath, plan.id)).resolves.toEqual([task]);
    await expect(store.listEvents(workspacePath, plan.id)).resolves.toEqual([
      {
        id: storedEvent.id,
        timestamp: "2026-05-04T13:30:12.000Z",
        ...event,
      },
    ]);
    expect(storedEvent.id).toEqual(expect.any(String));
    expect(artifact.relativePath).toBe("artifacts/T001-codex-result.md");
    await expect(readFile(artifact.absolutePath, "utf8")).resolves.toBe("Done");
  });

  it("folds listTasks to the latest task state while preserving append-only task history", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-fold-tasks", "# Fold Tasks");
    const plan = await store.createPlan(workspacePath, {
      title: "Fold Tasks",
      sourceTaskDirectoryName: "20260504-1330-fold-tasks",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });
    const running: TaskPlanTask = {
      id: "T001",
      title: "T001",
      status: "running",
      assigneeProfileId: "codex",
      attempt: 1,
    };
    const review: TaskPlanTask = {
      ...running,
      status: "review",
      artifactPath: "artifacts/T001-codex.md",
    };
    const done: TaskPlanTask = {
      ...review,
      status: "done",
      assigneeProfileId: null,
      description: "Accepted",
    };

    await store.appendTask(workspacePath, plan.id, running);
    await store.appendTask(workspacePath, plan.id, review);
    await store.appendTask(workspacePath, plan.id, done);

    await expect(store.listTaskHistory(workspacePath, plan.id)).resolves.toEqual([running, review, done]);
    await expect(store.listTasks(workspacePath, plan.id)).resolves.toEqual([done]);
    expect((await store.listTasks(workspacePath, plan.id))[0].attempt).toBe(1);
  });

  it("updates plan status without changing the plan directory identity", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-status-update", "# Status Update");
    const plan = await store.createPlan(workspacePath, {
      title: "Status Update",
      sourceTaskDirectoryName: "20260504-1330-status-update",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    const updated = await store.updatePlanStatus(workspacePath, plan.id, "running");

    expect(updated).toMatchObject({
      id: plan.id,
      status: "running",
      planPath: plan.planPath,
      updatedAt: "2026-05-04T13:30:12.000Z",
    });
    await expect(store.getPlan(workspacePath, plan.id)).resolves.toMatchObject({
      status: "running",
      planPath: plan.planPath,
    });
  });

  it("rejects artifact paths that escape or nest under the artifacts directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-safe-paths", "# Safe Paths");
    const plan = await store.createPlan(workspacePath, {
      title: "Safe Paths",
      sourceTaskDirectoryName: "20260504-1330-safe-paths",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });

    await expect(store.writeArtifact(workspacePath, plan.id, "../escape.md", "bad")).rejects.toThrow(
      "Invalid artifact path",
    );
    await expect(store.writeArtifact(workspacePath, plan.id, "nested/result.md", "bad")).rejects.toThrow(
      "Invalid artifact path",
    );
    await expect(store.writeArtifact(workspacePath, plan.id, "nested\\result.md", "bad")).rejects.toThrow(
      "Invalid artifact path",
    );
  });

  it("rejects duplicate artifact writes without overwriting the original file", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-artifact-collision", "# Artifact Collision");
    const plan = await store.createPlan(workspacePath, {
      title: "Artifact Collision",
      sourceTaskDirectoryName: "20260504-1330-artifact-collision",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });
    const artifact = await store.writeArtifact(workspacePath, plan.id, "T001-result.md", "first");

    await expect(store.writeArtifact(workspacePath, plan.id, "T001-result.md", "second")).rejects.toThrow();
    await expect(readFile(artifact.absolutePath, "utf8")).resolves.toBe("first");
  });

  it("skips malformed task jsonl lines and returns parseable task records", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-task-recovery", "# Task Recovery");
    const plan = await store.createPlan(workspacePath, {
      title: "Task Recovery",
      sourceTaskDirectoryName: "20260504-1330-task-recovery",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });
    const task: TaskPlanTask = {
      id: "T001",
      title: "Keep task",
      status: "pending",
      assigneeProfileId: "codex",
      attempt: 0,
    };
    await store.appendTask(workspacePath, plan.id, task);
    await appendFile(path.join(plan.planPath, "tasks.jsonl"), "{bad json\n", "utf8");

    await expect(store.listTasks(workspacePath, plan.id)).resolves.toEqual([task]);
  });

  it("skips malformed event jsonl lines and returns parseable event records", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-event-recovery", "# Event Recovery");
    const plan = await store.createPlan(workspacePath, {
      title: "Event Recovery",
      sourceTaskDirectoryName: "20260504-1330-event-recovery",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });
    const event: TaskPlanEventInput = {
      type: "assigned",
      taskId: "T001",
      fromProfileId: "claude",
      toProfileId: "codex",
      message: "Keep event",
    };
    const storedEvent = await store.appendEvent(workspacePath, plan.id, event);
    await appendFile(path.join(plan.planPath, "events.jsonl"), "{bad json\n", "utf8");

    await expect(store.listEvents(workspacePath, plan.id)).resolves.toEqual([storedEvent]);
  });

  it("ignores a tampered planPath in plan metadata and uses the discovered plan directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    outsidePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-outside-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-tamper-proof", "# Original Plan");
    const plan = await store.createPlan(workspacePath, {
      title: "Tamper Proof",
      sourceTaskDirectoryName: "20260504-1330-tamper-proof",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    });
    await writeFile(path.join(outsidePath, "task-plan.md"), "# Outside Plan", "utf8");
    await writeFile(
      path.join(plan.planPath, "plan.json"),
      `${JSON.stringify({ ...plan, planPath: outsidePath }, null, 2)}\n`,
      "utf8",
    );

    const listedPlan = (await store.listPlans(workspacePath))[0];
    await expect(store.getPlan(workspacePath, plan.id)).resolves.toMatchObject({ planPath: plan.planPath });
    expect(listedPlan?.planPath).toBe(plan.planPath);
    await expect(store.readMarkdown(workspacePath, plan.id)).resolves.toBe("# Original Plan");

    const artifact = await store.writeArtifact(workspacePath, plan.id, "T001-result.md", "Done");
    expect(artifact.absolutePath).toBe(path.join(plan.planPath, "artifacts", "T001-result.md"));
    await expect(readFile(path.join(plan.planPath, "artifacts", "T001-result.md"), "utf8")).resolves.toBe("Done");
    await expect(readFile(path.join(outsidePath, "artifacts", "T001-result.md"), "utf8")).rejects.toThrow();
  });

  it("rejects duplicate plan directories without overwriting the existing plan files", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-task-plan-"));
    const store = new TaskPlanStore({ now: () => new Date("2026-05-04T13:30:12.000Z") });
    await writeTaskSource(workspacePath, "20260504-1330-duplicate-plan", "# First Plan");
    const input = {
      title: "Duplicate Plan",
      sourceTaskDirectoryName: "20260504-1330-duplicate-plan",
      managerProfileId: "claude",
      participantProfileIds: ["codex"],
    };
    const plan = await store.createPlan(workspacePath, input);
    await writeTaskSource(workspacePath, "20260504-1330-duplicate-plan", "# Second Plan");

    await expect(store.createPlan(workspacePath, input)).rejects.toThrow("Task plan already exists");
    await expect(readFile(path.join(plan.planPath, "task-plan.md"), "utf8")).resolves.toBe("# First Plan");
  });
});

async function writeTaskSource(workspacePath: string, directoryName: string, markdown: string): Promise<string> {
  const taskDir = path.join(workspacePath, "tasks", directoryName);
  await mkdir(taskDir, { recursive: true });
  const sourcePlanPath = path.join(taskDir, "task-plan.md");
  await writeFile(sourcePlanPath, markdown, "utf8");
  return sourcePlanPath;
}
