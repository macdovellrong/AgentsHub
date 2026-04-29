import { describe, expect, it } from "vitest";
import { EVENT_TYPE_LABELS, STATUS_LABELS, UI_TEXT, formatEventTypeLabel, formatStatusLabel } from "./ui-text";

describe("UI_TEXT", () => {
  it("uses Chinese labels for the main dashboard sections", () => {
    expect(UI_TEXT.sections).toMatchObject({
      profiles: "智能体",
      profileEditor: "角色配置",
      conversation: "协作消息",
      orchestration: "受控编排",
      forwarding: "转发控制",
      tasks: "任务看板",
      terminals: "终端",
      runs: "运行记录",
    });
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
