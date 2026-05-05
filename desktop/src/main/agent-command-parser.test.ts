import { describe, expect, it } from "vitest";
import { parseAgentHubCommands } from "./agent-command-parser";
import type { AgentHubCommand, ParseAgentHubCommandsResult } from "./agent-command-parser";

describe("parseAgentHubCommands", () => {
  it("parses a send command block", () => {
    const text = [
      "Delegating work:",
      "<agenthub>",
      '{"action":"send","target":"codex","task_id":"T-001","message":"Implement task A"}',
      "</agenthub>",
    ].join("\n");

    const result: ParseAgentHubCommandsResult = parseAgentHubCommands(text);

    expect(result).toEqual({
      commands: [
        {
          action: "send",
          target: "codex",
          task_id: "T-001",
          message: "Implement task A",
        } satisfies AgentHubCommand,
      ],
      errors: [],
    });
  });

  it("parses ask_user and done command blocks", () => {
    const text = [
      "<agenthub>",
      '{"action":"ask_user","message":"Which workspace should I use?"}',
      "</agenthub>",
      "Intermediate agent notes",
      "<agenthub>",
      '{"action":"done","message":"Finished the requested task"}',
      "</agenthub>",
      "<agenthub>",
      '{"action":"done"}',
      "</agenthub>",
    ].join("\n");

    expect(parseAgentHubCommands(text)).toEqual({
      commands: [
        {
          action: "ask_user",
          message: "Which workspace should I use?",
        },
        {
          action: "done",
          message: "Finished the requested task",
        },
        {
          action: "done",
        },
      ],
      errors: [],
    });
  });

  it("parses provider-neutral team commands", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"send_message","to":"gemini","message":"Please review this plan.","team_id":"default","task_id":"T-001"}</agenthub>',
        '<agenthub>{"action":"claim_task","task_id":"T-001"}</agenthub>',
        '<agenthub>{"action":"complete_task","task_id":"T-001","summary":"Implementation finished."}</agenthub>',
      ].join("\n"),
    );

    expect(result).toEqual({
      commands: [
        {
          action: "send_message",
          to: "gemini",
          message: "Please review this plan.",
          team_id: "default",
          task_id: "T-001",
        },
        {
          action: "claim_task",
          task_id: "T-001",
        },
        {
          action: "complete_task",
          task_id: "T-001",
          summary: "Implementation finished.",
        },
      ],
      errors: [],
    });
  });

  it("parses task plan manager commands", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"assign_task","plan_id":"P001","task_id":"T001","to":"codex","message":"Implement T001"}</agenthub>',
        '<agenthub>{"action":"approve_task","plan_id":"P001","task_id":"T001","summary":"Looks good"}</agenthub>',
        '<agenthub>{"action":"reject_task","plan_id":"P001","task_id":"T001","to":"codex","message":"Add tests"}</agenthub>',
        '<agenthub>{"action":"request_review","plan_id":"P001","task_id":"T001","to":"gemini","message":"Review risk"}</agenthub>',
        '<agenthub>{"action":"pause_plan","plan_id":"P001","reason":"Need user decision"}</agenthub>',
      ].join("\n"),
    );

    expect(result).toEqual({
      commands: [
        {
          action: "assign_task",
          plan_id: "P001",
          task_id: "T001",
          to: "codex",
          message: "Implement T001",
        },
        {
          action: "approve_task",
          plan_id: "P001",
          task_id: "T001",
          summary: "Looks good",
        },
        {
          action: "reject_task",
          plan_id: "P001",
          task_id: "T001",
          to: "codex",
          message: "Add tests",
        },
        {
          action: "request_review",
          plan_id: "P001",
          task_id: "T001",
          to: "gemini",
          message: "Review risk",
        },
        {
          action: "pause_plan",
          plan_id: "P001",
          reason: "Need user decision",
        },
      ],
      errors: [],
    });
  });

  it("parses pair negotiation continue and accept commands", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"continue","proposal_version":2,"message":"Please review version 2.","message_to":"codex","summary":"Version 2 adds tests.","stance":"revise"}</agenthub>',
        '<agenthub>{"action":"accept","proposal_version":2,"summary":"Version 2 is ready.","stance":"accepted"}</agenthub>',
        '<agenthub>{"action":"continue","proposal_version":3,"artifact_path":"negotiation/proposal-v3.md","message_to":"codex","summary":"Version 3 is attached.","stance":"revise"}</agenthub>',
        '<agenthub>{"action":"accept","proposal_version":3,"summary":"Version 3 is ready.","artifact_path":"negotiation/proposal-v3.md","stance":"accepted"}</agenthub>',
      ].join("\n"),
    );

    expect(result).toEqual({
      commands: [
        {
          action: "continue",
          proposal_version: 2,
          message: "Please review version 2.",
          message_to: "codex",
          summary: "Version 2 adds tests.",
          stance: "revise",
        },
        {
          action: "accept",
          proposal_version: 2,
          summary: "Version 2 is ready.",
          stance: "accepted",
        },
        {
          action: "continue",
          proposal_version: 3,
          artifact_path: "negotiation/proposal-v3.md",
          message_to: "codex",
          summary: "Version 3 is attached.",
          stance: "revise",
        },
        {
          action: "accept",
          proposal_version: 3,
          summary: "Version 3 is ready.",
          artifact_path: "negotiation/proposal-v3.md",
          stance: "accepted",
        },
      ],
      errors: [],
    });
  });

  it("returns a structured error for invalid JSON without throwing", () => {
    const text = [
      "<agenthub>",
      '{"action":"send","target":"codex",',
      "</agenthub>",
    ].join("\n");

    expect(() => parseAgentHubCommands(text)).not.toThrow();
    expect(parseAgentHubCommands(text)).toEqual({
      commands: [],
      errors: [
        expect.objectContaining({
          index: 0,
          code: "invalid_json",
          message: "Invalid JSON in agenthub command block",
          block: '{"action":"send","target":"codex",',
        }),
      ],
    });
  });

  it("returns a structured error for an unclosed command block", () => {
    const result = parseAgentHubCommands('<agenthub>{"action":"done"}');

    expect(result).toEqual({
      commands: [],
      errors: [
        expect.objectContaining({
          index: 0,
          code: "unclosed_block",
          block: '{"action":"done"}',
        }),
      ],
    });
  });

  it("allows the closing tag text inside JSON strings", () => {
    const result = parseAgentHubCommands(
      '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"literal </agenthub> text"}</agenthub>',
    );

    expect(result).toEqual({
      commands: [
        {
          action: "send",
          target: "codex",
          task_id: "T-001",
          message: "literal </agenthub> text",
        },
      ],
      errors: [],
    });
  });

  it("resynchronizes after a malformed unterminated string block", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"unterminated</agenthub>',
        '<agenthub>{"action":"done","message":"Recovered"}</agenthub>',
      ].join("\n"),
    );

    expect(result.commands).toEqual([{ action: "done", message: "Recovered" }]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "unclosed_block",
      }),
    ]);
  });

  it("resynchronizes when an unclosed malformed block is followed by another command block", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"send","target":"codex","task_id":"T-001","message":"unterminated',
        '<agenthub>{"action":"done","message":"Recovered"}</agenthub>',
      ].join("\n"),
    );

    expect(result.commands).toEqual([{ action: "done", message: "Recovered" }]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "unclosed_block",
      }),
    ]);
  });

  it("rejects unknown actions with a structured validation error", () => {
    const result = parseAgentHubCommands([
      "<agenthub>",
      '{"action":"launch","target":"codex","message":"Run this"}',
      "</agenthub>",
    ].join("\n"));

    expect(result).toEqual({
      commands: [],
      errors: [
        expect.objectContaining({
          index: 0,
          code: "invalid_action",
          message: 'Unsupported agenthub action "launch"',
        }),
      ],
    });
  });

  it("rejects send commands missing required string fields", () => {
    const result = parseAgentHubCommands([
      "<agenthub>",
      '{"action":"send","task_id":"T-001","message":"Implement task A"}',
      "</agenthub>",
      "<agenthub>",
      '{"action":"send","target":"codex","message":"Implement task A"}',
      "</agenthub>",
      "<agenthub>",
      '{"action":"send","target":"codex","task_id":"T-001","message":12}',
      "</agenthub>",
    ].join("\n"));

    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "invalid_command",
        message: 'send command requires string field "target"',
      }),
      expect.objectContaining({
        index: 1,
        code: "invalid_command",
        message: 'send command requires string field "task_id"',
      }),
      expect.objectContaining({
        index: 2,
        code: "invalid_command",
        message: 'send command requires string field "message"',
      }),
    ]);
  });

  it("rejects ask_user and done commands with invalid message fields", () => {
    const result = parseAgentHubCommands([
      "<agenthub>",
      '{"action":"ask_user"}',
      "</agenthub>",
      "<agenthub>",
      '{"action":"done","message":true}',
      "</agenthub>",
    ].join("\n"));

    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "invalid_command",
        message: 'ask_user command requires string field "message"',
      }),
      expect.objectContaining({
        index: 1,
        code: "invalid_command",
        message: 'done command optional field "message" must be a string',
      }),
    ]);
  });

  it("rejects provider-neutral team commands missing required fields", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"send_message","message":"Missing target"}</agenthub>',
        '<agenthub>{"action":"send_message","to":"codex"}</agenthub>',
        '<agenthub>{"action":"claim_task"}</agenthub>',
        '<agenthub>{"action":"complete_task","task_id":"T-001","summary":12}</agenthub>',
      ].join("\n"),
    );

    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "invalid_command",
        message: 'send_message command requires string field "to"',
      }),
      expect.objectContaining({
        index: 1,
        code: "invalid_command",
        message: 'send_message command requires string field "message"',
      }),
      expect.objectContaining({
        index: 2,
        code: "invalid_command",
        message: 'claim_task command requires string field "task_id"',
      }),
      expect.objectContaining({
        index: 3,
        code: "invalid_command",
        message: 'complete_task command optional field "summary" must be a string',
      }),
    ]);
  });

  it("rejects task plan manager commands missing required fields or using wrong field types", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"assign_task","task_id":"T001","to":"codex","message":"Missing plan"}</agenthub>',
        '<agenthub>{"action":"approve_task","plan_id":"P001","summary":"Missing task"}</agenthub>',
        '<agenthub>{"action":"reject_task","plan_id":"P001","task_id":12,"to":"codex","message":"Bad task"}</agenthub>',
        '<agenthub>{"action":"request_review","plan_id":"P001","task_id":"T001","to":false,"message":"Bad target"}</agenthub>',
        '<agenthub>{"action":"pause_plan","plan_id":"P001","reason":12}</agenthub>',
      ].join("\n"),
    );

    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "invalid_command",
        message: 'assign_task command requires string field "plan_id"',
      }),
      expect.objectContaining({
        index: 1,
        code: "invalid_command",
        message: 'approve_task command requires string field "task_id"',
      }),
      expect.objectContaining({
        index: 2,
        code: "invalid_command",
        message: 'reject_task command requires string field "task_id"',
      }),
      expect.objectContaining({
        index: 3,
        code: "invalid_command",
        message: 'request_review command requires string field "to"',
      }),
      expect.objectContaining({
        index: 4,
        code: "invalid_command",
        message: 'pause_plan command requires string field "reason"',
      }),
    ]);
  });

  it("rejects empty or blank required string fields", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"assign_task","plan_id":"","task_id":"T001","to":"codex","message":"Empty plan"}</agenthub>',
        '<agenthub>{"action":"assign_task","plan_id":"   ","task_id":"T001","to":"codex","message":"Blank plan"}</agenthub>',
        '<agenthub>{"action":"assign_task","plan_id":"P001","task_id":"T001","to":"codex","message":""}</agenthub>',
        '<agenthub>{"action":"assign_task","plan_id":"P001","task_id":"T001","to":"codex","message":"   "}</agenthub>',
        '<agenthub>{"action":"send_message","to":"","message":"Legacy empty target"}</agenthub>',
        '<agenthub>{"action":"send_message","to":"codex","message":"   "}</agenthub>',
      ].join("\n"),
    );

    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "invalid_command",
        message: 'assign_task command requires string field "plan_id"',
      }),
      expect.objectContaining({
        index: 1,
        code: "invalid_command",
        message: 'assign_task command requires string field "plan_id"',
      }),
      expect.objectContaining({
        index: 2,
        code: "invalid_command",
        message: 'assign_task command requires string field "message"',
      }),
      expect.objectContaining({
        index: 3,
        code: "invalid_command",
        message: 'assign_task command requires string field "message"',
      }),
      expect.objectContaining({
        index: 4,
        code: "invalid_command",
        message: 'send_message command requires string field "to"',
      }),
      expect.objectContaining({
        index: 5,
        code: "invalid_command",
        message: 'send_message command requires string field "message"',
      }),
    ]);
  });

  it("rejects pair negotiation commands missing required fields", () => {
    const result = parseAgentHubCommands(
      [
        '<agenthub>{"action":"continue","message":"Missing proposal version"}</agenthub>',
        '<agenthub>{"action":"continue","proposal_version":1}</agenthub>',
        '<agenthub>{"action":"accept","proposal_version":1}</agenthub>',
        '<agenthub>{"action":"accept","proposal_version":"1","summary":"Wrong type"}</agenthub>',
      ].join("\n"),
    );

    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        index: 0,
        code: "invalid_command",
        message: 'continue command requires numeric field "proposal_version"',
      }),
      expect.objectContaining({
        index: 1,
        code: "invalid_command",
        message: 'continue command requires string field "message" or "artifact_path"',
      }),
      expect.objectContaining({
        index: 2,
        code: "invalid_command",
        message: 'accept command requires string field "summary"',
      }),
      expect.objectContaining({
        index: 3,
        code: "invalid_command",
        message: 'accept command requires numeric field "proposal_version"',
      }),
    ]);
  });
});
