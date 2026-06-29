using System.Text.Json;

namespace AgentHub.Native.Core.Collaboration;

public static class AgentHubCommandParser
{
    private const string OpenTag = "<agenthub>";
    private const string CloseTag = "</agenthub>";

    public static AgentHubCommandParseResult Parse(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return new AgentHubCommandParseResult([], [], [], [], []);
        }

        var commands = new List<AgentHubSendMessageCommand>();
        var planStatusCommands = new List<AgentHubPlanStatusCommand>();
        var teamStatusCommands = new List<AgentHubTeamStatusCommand>();
        var workflowCommands = new List<AgentHubWorkflowCommand>();
        var errors = new List<AgentHubCommandParseError>();
        var cursor = 0;
        var index = 0;

        while (cursor < text.Length)
        {
            var openIndex = text.IndexOf(OpenTag, cursor, StringComparison.Ordinal);
            if (openIndex < 0)
            {
                break;
            }

            var blockStart = openIndex + OpenTag.Length;
            var closeIndex = FindCloseTagOutsideJsonString(text, blockStart);
            if (closeIndex < 0)
            {
                errors.Add(new AgentHubCommandParseError(
                    index,
                    "unclosed_block",
                    "agenthub command block is missing a closing tag",
                    text[blockStart..].Trim()));
                break;
            }

            var block = text[blockStart..closeIndex].Trim();
            cursor = closeIndex + CloseTag.Length;
            try
            {
                using var document = JsonDocument.Parse(block);
                var result = ValidateCommand(document.RootElement, index, block);
                if (result.SendMessageCommand is not null)
                {
                    commands.Add(result.SendMessageCommand);
                }
                else if (result.PlanStatusCommand is not null)
                {
                    planStatusCommands.Add(result.PlanStatusCommand);
                }
                else if (result.TeamStatusCommand is not null)
                {
                    teamStatusCommands.Add(result.TeamStatusCommand);
                }
                else if (result.WorkflowCommand is not null)
                {
                    workflowCommands.Add(result.WorkflowCommand);
                }
                else if (result.Error is not null)
                {
                    errors.Add(result.Error);
                }
            }
            catch (JsonException)
            {
                errors.Add(new AgentHubCommandParseError(
                    index,
                    "invalid_json",
                    "Invalid JSON in agenthub command block",
                    block));
            }

            index += 1;
        }

        return new AgentHubCommandParseResult(commands, planStatusCommands, teamStatusCommands, workflowCommands, errors);
    }

    private static ValidationResult ValidateCommand(JsonElement root, int index, string block)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return ValidationResult.Invalid(index, block, "agenthub command must be a JSON object");
        }

        if (!TryGetString(root, "action", out var action))
        {
            return new ValidationResult(
                null,
                null,
                null,
                null,
                new AgentHubCommandParseError(
                    index,
                    "invalid_action",
                    "agenthub command requires string field \"action\"",
                    block));
        }

        if (string.Equals(action, "send_message", StringComparison.Ordinal))
        {
            return ValidateSendMessageCommand(root, index, block);
        }

        if (string.Equals(action, "send", StringComparison.Ordinal))
        {
            return ValidateLegacySendCommand(root, index, block);
        }

        if (IsTaskPlanRoutingAction(action))
        {
            return ValidateTaskPlanRoutingCommand(root, index, block, action);
        }

        if (string.Equals(action, "claim_task", StringComparison.Ordinal))
        {
            return ValidateClaimTaskCommand(root, index, block);
        }

        if (string.Equals(action, "complete_task", StringComparison.Ordinal))
        {
            return ValidateCompleteTaskCommand(root, index, block);
        }

        if (string.Equals(action, "ask_user", StringComparison.Ordinal))
        {
            return ValidateAskUserCommand(root, index, block);
        }

        if (string.Equals(action, "done", StringComparison.Ordinal))
        {
            return ValidateDoneCommand(root, index, block);
        }

        if (string.Equals(action, "approve_task", StringComparison.Ordinal))
        {
            return ValidateApproveTaskCommand(root, index, block);
        }

        if (string.Equals(action, "pause_plan", StringComparison.Ordinal))
        {
            return ValidatePausePlanCommand(root, index, block);
        }

        return new ValidationResult(
            null,
                null,
                null,
                null,
                new AgentHubCommandParseError(
                    index,
                    "invalid_action",
                $"Unsupported agenthub action \"{action}\"",
                block));
    }

    private static ValidationResult ValidateSendMessageCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "to", out var to))
        {
            return ValidationResult.Invalid(index, block, "send_message command requires string field \"to\"");
        }

        if (!TryGetRequiredString(root, "message", out var message))
        {
            return ValidationResult.Invalid(index, block, "send_message command requires string field \"message\"");
        }

        return new ValidationResult(
            new AgentHubSendMessageCommand(
                to,
                message,
                OptionalString(root, "team_id"),
                OptionalString(root, "task_id"),
                null,
                OptionalString(root, "conversation_id")),
            null,
            null,
            null,
            null);
    }

    private static ValidationResult ValidateLegacySendCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "target", out var target))
        {
            return ValidationResult.Invalid(index, block, "send command requires string field \"target\"");
        }

        if (!TryGetRequiredString(root, "task_id", out var taskId))
        {
            return ValidationResult.Invalid(index, block, "send command requires string field \"task_id\"");
        }

        if (!TryGetRequiredString(root, "message", out var message))
        {
            return ValidationResult.Invalid(index, block, "send command requires string field \"message\"");
        }

        return new ValidationResult(
            new AgentHubSendMessageCommand(
                target,
                message,
                null,
                taskId,
                null,
                null),
            null,
            null,
            null,
            null);
    }

    private static ValidationResult ValidateTaskPlanRoutingCommand(
        JsonElement root,
        int index,
        string block,
        string action)
    {
        if (!TryGetRequiredString(root, "plan_id", out var planId))
        {
            return ValidationResult.Invalid(index, block, $"{action} command requires string field \"plan_id\"");
        }

        if (!TryGetRequiredString(root, "task_id", out var taskId))
        {
            return ValidationResult.Invalid(index, block, $"{action} command requires string field \"task_id\"");
        }

        if (!TryGetRequiredString(root, "to", out var to))
        {
            return ValidationResult.Invalid(index, block, $"{action} command requires string field \"to\"");
        }

        if (!TryGetRequiredString(root, "message", out var message))
        {
            return ValidationResult.Invalid(index, block, $"{action} command requires string field \"message\"");
        }

        return new ValidationResult(
            new AgentHubSendMessageCommand(
                to,
                message,
                null,
                taskId,
                planId,
                null),
            null,
            null,
            null,
            null);
    }

    private static ValidationResult ValidateClaimTaskCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "task_id", out var taskId))
        {
            return ValidationResult.Invalid(index, block, "claim_task command requires string field \"task_id\"");
        }

        if (!TryGetOptionalString(root, "team_id", out var teamId))
        {
            return ValidationResult.Invalid(index, block, "claim_task command optional field \"team_id\" must be a string");
        }

        return new ValidationResult(
            null,
            null,
            new AgentHubTeamStatusCommand("claim_task", DefaultTeamId(teamId), taskId, null),
            null,
            null);
    }

    private static ValidationResult ValidateCompleteTaskCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "task_id", out var taskId))
        {
            return ValidationResult.Invalid(index, block, "complete_task command requires string field \"task_id\"");
        }

        if (!TryGetOptionalString(root, "team_id", out var teamId))
        {
            return ValidationResult.Invalid(index, block, "complete_task command optional field \"team_id\" must be a string");
        }

        if (!TryGetOptionalString(root, "summary", out var summary))
        {
            return ValidationResult.Invalid(index, block, "complete_task command optional field \"summary\" must be a string");
        }

        return new ValidationResult(
            null,
            null,
            new AgentHubTeamStatusCommand("complete_task", DefaultTeamId(teamId), taskId, summary),
            null,
            null);
    }

    private static ValidationResult ValidateAskUserCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "message", out var message))
        {
            return ValidationResult.Invalid(index, block, "ask_user command requires string field \"message\"");
        }

        return new ValidationResult(
            null,
            null,
            null,
            new AgentHubWorkflowCommand("ask_user", message),
            null);
    }

    private static ValidationResult ValidateDoneCommand(JsonElement root, int index, string block)
    {
        if (!TryGetOptionalString(root, "message", out var message))
        {
            return ValidationResult.Invalid(index, block, "done command optional field \"message\" must be a string");
        }

        return new ValidationResult(
            null,
            null,
            null,
            new AgentHubWorkflowCommand("done", message),
            null);
    }

    private static ValidationResult ValidateApproveTaskCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "plan_id", out var planId))
        {
            return ValidationResult.Invalid(index, block, "approve_task command requires string field \"plan_id\"");
        }

        if (!TryGetRequiredString(root, "task_id", out var taskId))
        {
            return ValidationResult.Invalid(index, block, "approve_task command requires string field \"task_id\"");
        }

        if (!TryGetRequiredString(root, "summary", out var summary))
        {
            return ValidationResult.Invalid(index, block, "approve_task command requires string field \"summary\"");
        }

        return new ValidationResult(
            null,
            new AgentHubPlanStatusCommand("approve_task", planId, taskId, summary),
            null,
            null,
            null);
    }

    private static ValidationResult ValidatePausePlanCommand(JsonElement root, int index, string block)
    {
        if (!TryGetRequiredString(root, "plan_id", out var planId))
        {
            return ValidationResult.Invalid(index, block, "pause_plan command requires string field \"plan_id\"");
        }

        if (!TryGetRequiredString(root, "reason", out var reason))
        {
            return ValidationResult.Invalid(index, block, "pause_plan command requires string field \"reason\"");
        }

        return new ValidationResult(
            null,
            new AgentHubPlanStatusCommand("pause_plan", planId, null, reason),
            null,
            null,
            null);
    }

    private static bool IsTaskPlanRoutingAction(string action)
    {
        return string.Equals(action, "assign_task", StringComparison.Ordinal) ||
               string.Equals(action, "reject_task", StringComparison.Ordinal) ||
               string.Equals(action, "request_review", StringComparison.Ordinal);
    }

    private static int FindCloseTagOutsideJsonString(string text, int start)
    {
        var inString = false;
        var escaped = false;
        for (var index = start; index < text.Length; index += 1)
        {
            var character = text[index];
            if (escaped)
            {
                escaped = false;
                continue;
            }

            if (character == '\\')
            {
                escaped = inString;
                continue;
            }

            if (character == '"')
            {
                inString = !inString;
                continue;
            }

            if (!inString && text.AsSpan(index).StartsWith(CloseTag, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return -1;
    }

    private static bool TryGetRequiredString(JsonElement root, string propertyName, out string value)
    {
        if (TryGetString(root, propertyName, out value) && value.Trim().Length > 0)
        {
            return true;
        }

        value = "";
        return false;
    }

    private static string? OptionalString(JsonElement root, string propertyName)
    {
        return TryGetString(root, propertyName, out var value) ? value : null;
    }

    private static string DefaultTeamId(string? teamId)
    {
        return string.IsNullOrWhiteSpace(teamId) ? "default" : teamId;
    }

    private static bool TryGetOptionalString(JsonElement root, string propertyName, out string? value)
    {
        if (!root.TryGetProperty(propertyName, out var property))
        {
            value = null;
            return true;
        }

        if (property.ValueKind == JsonValueKind.String)
        {
            value = property.GetString();
            return true;
        }

        value = null;
        return false;
    }

    private static bool TryGetString(JsonElement root, string propertyName, out string value)
    {
        if (root.TryGetProperty(propertyName, out var property) &&
            property.ValueKind == JsonValueKind.String)
        {
            value = property.GetString() ?? "";
            return true;
        }

        value = "";
        return false;
    }

    private sealed record ValidationResult(
        AgentHubSendMessageCommand? SendMessageCommand,
        AgentHubPlanStatusCommand? PlanStatusCommand,
        AgentHubTeamStatusCommand? TeamStatusCommand,
        AgentHubWorkflowCommand? WorkflowCommand,
        AgentHubCommandParseError? Error)
    {
        public static ValidationResult Invalid(int index, string block, string message)
        {
            return new ValidationResult(
                null,
                null,
                null,
                null,
                new AgentHubCommandParseError(index, "invalid_command", message, block));
        }
    }
}
