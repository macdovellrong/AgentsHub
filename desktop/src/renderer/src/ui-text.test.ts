import { describe, expect, it } from "vitest";
import { EVENT_TYPE_LABELS, STATUS_LABELS, UI_TEXT, formatEventTypeLabel, formatStatusLabel } from "./ui-text";

describe("UI_TEXT", () => {
  it("uses Chinese labels for the main dashboard sections", () => {
    expect(UI_TEXT.sections).toMatchObject({
      profiles: "智能体",
      profileEditor: "角色配置",
      conversation: "协作消息",
      forwarding: "转发控制",
      taskPlans: "任务计划",
      terminals: "终端",
      runs: "运行记录",
    });
  });

  it("uses Chinese labels for task plan controls", () => {
    expect(UI_TEXT.sections.taskPlans).toBe("任务计划");
    expect(UI_TEXT.placeholders.taskPlanTitle).toBe("计划标题（从选中的 tasks 目录创建快照）");
    expect(UI_TEXT.hints.taskPlanSource).toBe("读取当前工作区 tasks/<时间-标题>/task-plan.md，并保存为这次执行的历史快照。");
    expect(UI_TEXT.buttons.generateTaskPlan).toBe("生成任务计划");
    expect(UI_TEXT.buttons.startTaskPlanManager).toBe("交给 Claude 管理");
    expect(UI_TEXT.buttons.openTaskPlanFolder).toBe("打开计划目录");
  });

  it("formats known status labels in Chinese", () => {
    expect(STATUS_LABELS.online).toBe("在线");
    expect(formatStatusLabel("waiting_previous_step")).toBe("等待上一步");
    expect(formatStatusLabel("custom_status")).toBe("custom status");
  });

  it("formats known event types in Chinese", () => {
    expect(EVENT_TYPE_LABELS.agent_forward).toBe("智能体转发");
    expect(formatEventTypeLabel("task_updated")).toBe("任务更新");
    expect(formatEventTypeLabel("custom_event")).toBe("custom event");
  });
});
