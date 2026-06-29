namespace AgentHub.Native.Core.Collaboration;

public static class AgentProfileTargetResolver
{
    public static IReadOnlyList<string> Resolve(string targetProfileId)
    {
        var normalized = targetProfileId.Trim().ToLowerInvariant();
        return normalized == "agents"
            ? ["codex", "claude", "gemini"]
            : [normalized];
    }
}
