namespace AgentHub.Native.Core.Collaboration;

public sealed record CollaborationUserMessage(
    string WorkspacePath,
    string ProfileId,
    string TargetProfileId,
    string Message);
