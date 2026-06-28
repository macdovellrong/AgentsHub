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
        foreach (var character in value)
        {
            if (character == '"')
            {
                builder.Append('\\');
            }

            builder.Append(character);
        }

        builder.Append('"');
        return builder.ToString();
    }
}
