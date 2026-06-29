using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.App;

public static class ManualUserMessageFactory
{
    public static CollaborationUserMessage Create(
        string workspacePath,
        string targetProfileId,
        string text,
        string? conversationId,
        string? planId)
    {
        return new CollaborationUserMessage(
            workspacePath,
            "user",
            targetProfileId,
            text,
            ConversationId: conversationId,
            PlanId: planId);
    }
}
