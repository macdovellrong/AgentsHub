using System.Text.RegularExpressions;

namespace AgentHub.Native.Core.Collaboration;

public static partial class AgentAddressedMessageParser
{
    private static readonly HashSet<string> KnownProfiles = new(StringComparer.OrdinalIgnoreCase)
    {
        "codex",
        "claude",
        "gemini",
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
        if (!KnownProfiles.Contains(profileId))
        {
            return null;
        }

        var message = match.Groups["message"].Value.Trim();
        return string.IsNullOrWhiteSpace(message)
            ? null
            : new AgentAddressedMessage(profileId, message);
    }

    [GeneratedRegex("^@(?<profile>[A-Za-z0-9_]+):?\\s+(?<message>.+)$", RegexOptions.CultureInvariant)]
    private static partial Regex AddressedMessageRegex();
}
