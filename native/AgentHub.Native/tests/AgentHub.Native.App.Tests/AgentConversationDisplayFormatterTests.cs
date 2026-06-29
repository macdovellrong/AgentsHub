using System.Reflection;
using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.App.Tests;

public sealed class AgentConversationDisplayFormatterTests
{
    [Fact]
    public void Formats_conversation_summary_with_status_mode_step_topic_and_id()
    {
        var conversation = new AgentConversation(
            "conversation-1",
            "pair_negotiation",
            "running",
            "claude",
            ["claude", "codex"],
            "Review terminal scrolling",
            2,
            6,
            DateTimeOffset.Parse("2026-06-29T12:00:00Z"),
            DateTimeOffset.Parse("2026-06-29T12:10:00Z"));

        var text = InvokeFormatter<string>("Format", conversation);

        Assert.Equal("running | pair_negotiation | 2/6 | Review terminal scrolling | conversation-1", text);
    }

    [Fact]
    public void Formats_conversation_details_with_participants_supervisor_and_folder()
    {
        var conversation = new AgentConversation(
            "conversation-1",
            "manager",
            "completed",
            "claude",
            ["codex", "gemini"],
            "Plan native terminal host",
            4,
            null,
            DateTimeOffset.Parse("2026-06-29T12:00:00Z"),
            DateTimeOffset.Parse("2026-06-29T12:10:00Z"));

        var details = InvokeFormatter<IReadOnlyList<string>>("FormatDetails", conversation, "V:\\Project\\.agenthub\\conversations\\conversation-1");

        Assert.Equal(
            [
                "id: conversation-1",
                "mode: manager",
                "status: completed",
                "topic: Plan native terminal host",
                "participants: codex, gemini",
                "supervisor: claude",
                "step: 4",
                "folder: V:\\Project\\.agenthub\\conversations\\conversation-1"
            ],
            details);
    }

    private static T InvokeFormatter<T>(string methodName, params object[] arguments)
    {
        var formatterType = Type.GetType("AgentHub.Native.App.AgentConversationDisplayFormatter, AgentHub.Native.App");
        if (formatterType is null)
        {
            throw new Xunit.Sdk.XunitException("AgentConversationDisplayFormatter type was not found.");
        }

        var method = formatterType.GetMethod(methodName, BindingFlags.Public | BindingFlags.Static);
        if (method is null)
        {
            throw new Xunit.Sdk.XunitException($"{methodName} method was not found.");
        }

        var result = method.Invoke(null, arguments);
        return Assert.IsAssignableFrom<T>(result);
    }
}
