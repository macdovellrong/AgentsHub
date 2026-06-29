using System.Text.RegularExpressions;

namespace AgentHub.Native.Core.Collaboration;

public static partial class AgentAddressedMessageParser
{
    private static readonly HashSet<string> KnownProfiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "codex",
        "claude",
        "gemini",
        "agents",
        "powershell",
        "cmd"
    };

    public static AgentAddressedMessage? Parse(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var match = AddressedMessageRegex().Match(raw.Trim());
        if (!match.Success)
        {
            return null;
        }

        var profileId = match.Groups["profile"].Value.ToLowerInvariant();
        if (!IsKnownProfileTarget(profileId))
        {
            return null;
        }

        var message = match.Groups["message"].Value.Trim();
        return string.IsNullOrWhiteSpace(message)
            ? null
            : new AgentAddressedMessage(profileId, message);
    }

    private static bool IsKnownProfileTarget(string profileId)
    {
        var targetProfileIds = AgentProfileTargetResolver.Resolve(profileId);
        return targetProfileIds.Count > 0 &&
               targetProfileIds.All(targetProfileId => KnownProfiles.Contains(targetProfileId));
    }

    [GeneratedRegex("^@(?<profile>[A-Za-z0-9_,]+):?\\s+(?<message>.+)$", RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex AddressedMessageRegex();
}
