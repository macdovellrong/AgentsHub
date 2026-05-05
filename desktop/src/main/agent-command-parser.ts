export type AgentHubCommand =
  | { action: "send"; target: string; task_id: string; message: string }
  | { action: "send_message"; to: string; message: string; team_id?: string; task_id?: string; conversation_id?: string }
  | { action: "claim_task"; task_id: string; team_id?: string }
  | { action: "complete_task"; task_id: string; summary?: string; team_id?: string }
  | { action: "assign_task"; plan_id: string; task_id: string; to: string; message: string }
  | { action: "approve_task"; plan_id: string; task_id: string; summary: string }
  | { action: "reject_task"; plan_id: string; task_id: string; to: string; message: string }
  | { action: "request_review"; plan_id: string; task_id: string; to: string; message: string }
  | { action: "pause_plan"; plan_id: string; reason: string }
  | {
      action: "continue";
      proposal_version: number;
      message?: string;
      artifact_path?: string;
      message_to?: string;
      summary?: string;
      stance?: string;
    }
  | {
      action: "accept";
      proposal_version: number;
      summary: string;
      artifact_path?: string;
      message_to?: string;
      stance?: string;
    }
  | { action: "ask_user"; message: string }
  | { action: "done"; message?: string };

export type AgentHubCommandParseError = {
  index: number;
  code: "invalid_json" | "invalid_action" | "invalid_command" | "unclosed_block";
  message: string;
  block: string;
};

export type ParseAgentHubCommandsResult = {
  commands: AgentHubCommand[];
  errors: AgentHubCommandParseError[];
};

const OPEN_TAG = "<agenthub>";
const CLOSE_TAG = "</agenthub>";

type JsonRecord = Record<string, unknown>;

type ValidationResult = { command: AgentHubCommand } | { error: AgentHubCommandParseError };

export function parseAgentHubCommands(text: string): ParseAgentHubCommandsResult {
  const commands: AgentHubCommand[] = [];
  const errors: AgentHubCommandParseError[] = [];

  let cursor = 0;
  let index = 0;
  while (cursor < text.length) {
    const openIndex = text.indexOf(OPEN_TAG, cursor);
    if (openIndex === -1) {
      break;
    }

    const blockStart = openIndex + OPEN_TAG.length;
    const closeIndex = findCloseTagOutsideJsonString(text, blockStart);
    if (closeIndex === -1) {
      const nextOpenIndex = text.indexOf(OPEN_TAG, blockStart);
      if (nextOpenIndex !== -1) {
        errors.push({
          index,
          code: "unclosed_block",
          message: "agenthub command block is missing a closing tag",
          block: text.slice(blockStart, nextOpenIndex).trim(),
        });
        index += 1;
        cursor = nextOpenIndex;
        continue;
      }
      const rawCloseIndex = text.indexOf(CLOSE_TAG, blockStart);
      if (rawCloseIndex !== -1) {
        errors.push({
          index,
          code: "invalid_json",
          message: "Invalid JSON before closing agenthub tag",
          block: text.slice(blockStart, rawCloseIndex).trim(),
        });
        index += 1;
        cursor = rawCloseIndex + CLOSE_TAG.length;
        continue;
      }
      errors.push({
        index,
        code: "unclosed_block",
        message: "agenthub command block is missing a closing tag",
        block: text.slice(blockStart).trim(),
      });
      break;
    }

    const block = text.slice(blockStart, closeIndex).trim();
    const nextCursor = closeIndex + CLOSE_TAG.length;
    let parsed: unknown;

    try {
      parsed = JSON.parse(block);
    } catch {
      errors.push({
        index,
        code: "invalid_json",
        message: "Invalid JSON in agenthub command block",
        block,
      });
      index += 1;
      cursor = nextCursor;
      continue;
    }

    const result = validateCommand(parsed, index, block);
    if ("command" in result) {
      commands.push(result.command);
    } else {
      errors.push(result.error);
    }

    index += 1;
    cursor = nextCursor;
  }

  return { commands, errors };
}

function findCloseTagOutsideJsonString(text: string, start: number): number {
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && text.startsWith(CLOSE_TAG, index)) {
      return index;
    }
  }

  return -1;
}

function validateCommand(value: unknown, index: number, block: string): ValidationResult {
  if (!isJsonRecord(value)) {
    return invalidCommand(index, block, "agenthub command must be a JSON object");
  }

  const { action } = value;
  if (typeof action !== "string") {
    return {
      error: {
        index,
        code: "invalid_action",
        message: 'agenthub command requires string field "action"',
        block,
      },
    };
  }

  switch (action) {
    case "send":
      return validateSendCommand(value, index, block);
    case "send_message":
      return validateSendMessageCommand(value, index, block);
    case "claim_task":
      return validateClaimTaskCommand(value, index, block);
    case "complete_task":
      return validateCompleteTaskCommand(value, index, block);
    case "assign_task":
      return validateAssignTaskCommand(value, index, block);
    case "approve_task":
      return validateApproveTaskCommand(value, index, block);
    case "reject_task":
      return validateRejectTaskCommand(value, index, block);
    case "request_review":
      return validateRequestReviewCommand(value, index, block);
    case "pause_plan":
      return validatePausePlanCommand(value, index, block);
    case "continue":
      return validateContinueCommand(value, index, block);
    case "accept":
      return validateAcceptCommand(value, index, block);
    case "ask_user":
      return validateAskUserCommand(value, index, block);
    case "done":
      return validateDoneCommand(value, index, block);
    default:
      return {
        error: {
          index,
          code: "invalid_action",
          message: `Unsupported agenthub action "${action}"`,
          block,
        },
      };
  }
}

function validateContinueCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const proposalVersion = requireNumberField(value, "proposal_version");
  if (!proposalVersion.ok) {
    return invalidCommand(index, block, 'continue command requires numeric field "proposal_version"');
  }

  if (typeof value.message !== "string" && typeof value.artifact_path !== "string") {
    return invalidCommand(index, block, 'continue command requires string field "message" or "artifact_path"');
  }

  const optional = optionalStringFields(value, ["message", "artifact_path", "message_to", "summary", "stance"], index, block, "continue");
  if ("error" in optional) {
    return optional;
  }

  return {
    command: {
      action: "continue",
      proposal_version: proposalVersion.value,
      ...optional.fields,
    },
  };
}

function validateAcceptCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const proposalVersion = requireNumberField(value, "proposal_version");
  if (!proposalVersion.ok) {
    return invalidCommand(index, block, 'accept command requires numeric field "proposal_version"');
  }

  const summary = requireStringField(value, "summary");
  if (!summary.ok) {
    return invalidCommand(index, block, 'accept command requires string field "summary"');
  }

  const optional = optionalStringFields(value, ["artifact_path", "message_to", "stance"], index, block, "accept");
  if ("error" in optional) {
    return optional;
  }

  return {
    command: {
      action: "accept",
      proposal_version: proposalVersion.value,
      summary: summary.value,
      ...optional.fields,
    },
  };
}

function validateSendMessageCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const to = requireStringField(value, "to");
  if (!to.ok) {
    return invalidCommand(index, block, 'send_message command requires string field "to"');
  }

  const message = requireStringField(value, "message");
  if (!message.ok) {
    return invalidCommand(index, block, 'send_message command requires string field "message"');
  }

  const optional = optionalStringFields(value, ["team_id", "task_id", "conversation_id"], index, block, "send_message");
  if ("error" in optional) {
    return optional;
  }

  return {
    command: {
      action: "send_message",
      to: to.value,
      message: message.value,
      ...optional.fields,
    },
  };
}

function validateClaimTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const taskId = requireStringField(value, "task_id");
  if (!taskId.ok) {
    return invalidCommand(index, block, 'claim_task command requires string field "task_id"');
  }

  const optional = optionalStringFields(value, ["team_id"], index, block, "claim_task");
  if ("error" in optional) {
    return optional;
  }

  return {
    command: {
      action: "claim_task",
      task_id: taskId.value,
      ...optional.fields,
    },
  };
}

function validateCompleteTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const taskId = requireStringField(value, "task_id");
  if (!taskId.ok) {
    return invalidCommand(index, block, 'complete_task command requires string field "task_id"');
  }

  const optional = optionalStringFields(value, ["team_id", "summary"], index, block, "complete_task");
  if ("error" in optional) {
    return optional;
  }

  return {
    command: {
      action: "complete_task",
      task_id: taskId.value,
      ...optional.fields,
    },
  };
}

function validateAssignTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "to", "message"], index, block, "assign_task");
  return "error" in required ? required : { command: { action: "assign_task", ...required.fields } };
}

function validateApproveTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "summary"], index, block, "approve_task");
  return "error" in required ? required : { command: { action: "approve_task", ...required.fields } };
}

function validateRejectTaskCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "to", "message"], index, block, "reject_task");
  return "error" in required ? required : { command: { action: "reject_task", ...required.fields } };
}

function validateRequestReviewCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "task_id", "to", "message"], index, block, "request_review");
  return "error" in required ? required : { command: { action: "request_review", ...required.fields } };
}

function validatePausePlanCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const required = requireStringFields(value, ["plan_id", "reason"], index, block, "pause_plan");
  return "error" in required ? required : { command: { action: "pause_plan", ...required.fields } };
}

function validateSendCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const target = requireStringField(value, "target");
  if (!target.ok) {
    return invalidCommand(index, block, 'send command requires string field "target"');
  }

  const taskId = requireStringField(value, "task_id");
  if (!taskId.ok) {
    return invalidCommand(index, block, 'send command requires string field "task_id"');
  }

  const message = requireStringField(value, "message");
  if (!message.ok) {
    return invalidCommand(index, block, 'send command requires string field "message"');
  }

  return {
    command: {
      action: "send",
      target: target.value,
      task_id: taskId.value,
      message: message.value,
    },
  };
}

function validateAskUserCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const message = requireStringField(value, "message");
  if (!message.ok) {
    return invalidCommand(index, block, 'ask_user command requires string field "message"');
  }

  return {
    command: {
      action: "ask_user",
      message: message.value,
    },
  };
}

function validateDoneCommand(value: JsonRecord, index: number, block: string): ValidationResult {
  const { message } = value;
  if (message !== undefined && typeof message !== "string") {
    return invalidCommand(index, block, 'done command optional field "message" must be a string');
  }

  return {
    command: message === undefined ? { action: "done" } : { action: "done", message },
  };
}

function requireStringField(
  value: JsonRecord,
  fieldName: string,
): { ok: true; value: string } | { ok: false } {
  const fieldValue = value[fieldName];
  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    return { ok: false };
  }

  return { ok: true, value: fieldValue };
}

function requireStringFields<FieldName extends string>(
  value: JsonRecord,
  fieldNames: FieldName[],
  index: number,
  block: string,
  action: string,
): { fields: Record<FieldName, string> } | { error: AgentHubCommandParseError } {
  const fields = {} as Record<FieldName, string>;
  for (const fieldName of fieldNames) {
    const field = requireStringField(value, fieldName);
    if (!field.ok) {
      return invalidCommand(index, block, `${action} command requires string field "${fieldName}"`);
    }
    fields[fieldName] = field.value;
  }
  return { fields };
}

function requireNumberField(
  value: JsonRecord,
  fieldName: string,
): { ok: true; value: number } | { ok: false } {
  const fieldValue = value[fieldName];
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    return { ok: false };
  }

  return { ok: true, value: fieldValue };
}

function optionalStringFields(
  value: JsonRecord,
  fieldNames: string[],
  index: number,
  block: string,
  action: string,
): { fields: Record<string, string> } | { error: AgentHubCommandParseError } {
  const fields: Record<string, string> = {};
  for (const fieldName of fieldNames) {
    const fieldValue = value[fieldName];
    if (fieldValue === undefined) {
      continue;
    }
    if (typeof fieldValue !== "string") {
      return invalidCommand(index, block, `${action} command optional field "${fieldName}" must be a string`);
    }
    fields[fieldName] = fieldValue;
  }
  return { fields };
}

function invalidCommand(index: number, block: string, message: string): { error: AgentHubCommandParseError } {
  return {
    error: {
      index,
      code: "invalid_command",
      message,
      block,
    },
  };
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
