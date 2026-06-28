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
            return new AgentHubCommandParseResult([], []);
        }

        var commands = new List<AgentHubSendMessageCommand>();
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
                if (result.Command is not null)
                {
                    commands.Add(result.Command);
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

        return new AgentHubCommandParseResult(commands, errors);
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

        return new ValidationResult(
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
        AgentHubSendMessageCommand? Command,
        AgentHubCommandParseError? Error)
    {
        public static ValidationResult Invalid(int index, string block, string message)
        {
            return new ValidationResult(
                null,
                new AgentHubCommandParseError(index, "invalid_command", message, block));
        }
    }
}
