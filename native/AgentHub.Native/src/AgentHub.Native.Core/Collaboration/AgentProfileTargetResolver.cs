namespace AgentHub.Native.Core.Collaboration;

public static class AgentProfileTargetResolver
{
    public static IReadOnlyList<string> Resolve(string targetProfileId)
    {
        var resolved = new List<string>();
        foreach (var token in targetProfileId.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var normalized = token.ToLowerInvariant();
            if (normalized == "agents")
            {
                resolved.AddRange(["codex", "claude", "gemini"]);
                continue;
            }

            resolved.Add(normalized);
        }

        return resolved.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
