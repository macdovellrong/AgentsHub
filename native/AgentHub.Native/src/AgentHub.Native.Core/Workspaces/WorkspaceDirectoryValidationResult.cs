namespace AgentHub.Native.Core.Workspaces;

public sealed record WorkspaceDirectoryValidationResult(
    bool IsValid,
    string? Path,
    string? ErrorMessage);
