using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.App;

public static class AgentConversationDisplayFormatter
{
    public static string Format(AgentConversation conversation)
    {
        var step = conversation.MaxSteps is null
            ? conversation.CurrentStep.ToString()
            : $"{conversation.CurrentStep}/{conversation.MaxSteps}";
        return string.Join(
            " | ",
            conversation.Status,
            conversation.Mode,
            step,
            OneLine(conversation.Topic),
            conversation.Id);
    }

    public static IReadOnlyList<string> FormatDetails(AgentConversation conversation, string folderPath)
    {
        var details = new List<string>
        {
            $"id: {conversation.Id}",
            $"mode: {conversation.Mode}",
            $"status: {conversation.Status}",
            $"topic: {OneLine(conversation.Topic)}",
            $"participants: {string.Join(", ", conversation.ParticipantProfileIds)}"
        };

        if (!string.IsNullOrWhiteSpace(conversation.SupervisorProfileId))
        {
            details.Add($"supervisor: {conversation.SupervisorProfileId}");
        }

        var step = conversation.MaxSteps is null
            ? conversation.CurrentStep.ToString()
            : $"{conversation.CurrentStep}/{conversation.MaxSteps}";
        details.Add($"step: {step}");
        details.Add($"folder: {folderPath}");
        return details;
    }

    private static string OneLine(string value)
    {
        return value
            .Replace("\r\n", " ", StringComparison.Ordinal)
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Trim();
    }
}
