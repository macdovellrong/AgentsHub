import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = __dirname;

function readRendererFile(relativePath: string): string {
  return readFileSync(join(rendererRoot, relativePath), "utf8");
}

describe("task plan layout", () => {
  it("renders the task plan panel instead of legacy orchestration and task panels", () => {
    const appSource = readRendererFile("App.tsx");

    expect(appSource).toContain('className="task-plan-panel panel"');
    expect(appSource).not.toContain('className="orchestration panel"');
    expect(appSource).not.toContain('className="tasks panel"');
  });

  it("uses the task plan preload API surface", () => {
    const appSource = readRendererFile("App.tsx");

    expect(appSource).toContain("listTaskPlans");
    expect(appSource).toContain("listTaskPlanSources");
    expect(appSource).toContain("createTaskPlan");
    expect(appSource).toContain("startTaskPlanManager");
    expect(appSource).toContain("readTaskPlanMarkdown");
    expect(appSource).toContain("openTaskPlanFolder");
  });

  it("creates task plans from selected project tasks directories instead of pasted markdown content", () => {
    const appSource = readRendererFile("App.tsx");

    expect(appSource).not.toContain("newTaskPlanMarkdown");
    expect(appSource).not.toContain("setNewTaskPlanMarkdown");
    expect(appSource).toContain("taskPlanSources");
    expect(appSource).toContain("selectedTaskPlanSourceDirectory");
    expect(appSource).toContain("UI_TEXT.hints.taskPlanSource");
  });

  it("offers a chat composer action to generate a task-plan prompt", () => {
    const appSource = readRendererFile("App.tsx");
    const uiTextSource = readRendererFile("ui-text.ts");

    expect(appSource).toContain("sendTaskPlanGenerationPrompt");
    expect(appSource).toContain("buildTaskPlanGenerationPrompt");
    expect(uiTextSource).toContain("生成任务计划");
  });
});
