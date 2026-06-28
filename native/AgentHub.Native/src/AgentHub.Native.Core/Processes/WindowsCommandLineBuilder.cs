using System.Text;

namespace AgentHub.Native.Core.Processes;

public static class WindowsCommandLineBuilder
{
    public static string Build(string executable, IReadOnlyList<string> arguments)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executable);
        ArgumentNullException.ThrowIfNull(arguments);

        var parts = new List<string> { Quote(executable) };
        parts.AddRange(arguments.Select(Quote));
        return string.Join(" ", parts);
    }

    private static string Quote(string value)
    {
        if (value.Length == 0)
        {
            return "\"\"";
        }

        var requiresQuotes = value.Any(char.IsWhiteSpace) || value.Contains('"', StringComparison.Ordinal);
        if (!requiresQuotes)
        {
            return value;
        }

        var builder = new StringBuilder(value.Length + 2);
        builder.Append('"');
        var pendingBackslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                pendingBackslashes += 1;
                continue;
            }

            if (character == '"')
            {
                builder.Append('\\', pendingBackslashes * 2 + 1);
                builder.Append(character);
                pendingBackslashes = 0;
                continue;
            }

            if (pendingBackslashes > 0)
            {
                builder.Append('\\', pendingBackslashes);
                pendingBackslashes = 0;
            }

            builder.Append(character);
        }

        if (pendingBackslashes > 0)
        {
            builder.Append('\\', pendingBackslashes * 2);
        }

        builder.Append('"');
        return builder.ToString();
    }
}
