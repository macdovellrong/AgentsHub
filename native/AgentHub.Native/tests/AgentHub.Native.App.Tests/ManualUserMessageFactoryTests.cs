using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.App.Tests;

public sealed class ManualUserMessageFactoryTests
{
    [Fact]
    public void Create_preserves_selected_conversation_and_task_plan_context()
    {
        var message = ManualUserMessageFactory.Create(
            @"V:\OrderManager",
            "codex",
            "continue the task",
            "conversation-123",
            "plan-456");

        Assert.Equal(@"V:\OrderManager", message.WorkspacePath);
        Assert.Equal("user", message.ProfileId);
        Assert.Equal("codex", message.TargetProfileId);
        Assert.Equal("continue the task", message.Message);
        Assert.Equal("conversation-123", message.ConversationId);
        Assert.Equal("plan-456", message.PlanId);
    }
}
