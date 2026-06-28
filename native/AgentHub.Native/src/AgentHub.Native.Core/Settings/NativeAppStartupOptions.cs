using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Settings;

public sealed record NativeAppStartupOptions(string? InitialWorkspacePath)
{
    public static NativeAppStartupOptions Empty { get; } = new((string?)null);

    public static NativeAppStartupOptions Parse(IReadOnlyList<string> args)
    {
        string? workspacePath = null;
        for (var index = 0; index < args.Count; index += 1)
        {
            var arg = args[index];
            if (arg.StartsWith("--workspace=", StringComparison.OrdinalIgnoreCase))
            {
                workspacePath = arg["--workspace=".Length..];
                continue;
            }

            if (string.Equals(arg, "--workspace", StringComparison.OrdinalIgnoreCase)
                || string.Equals(arg, "-w", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 < args.Count)
                {
                    workspacePath = args[index + 1];
                    index += 1;
                }
            }
        }

        return new NativeAppStartupOptions(WorkspacePathSelection.NormalizeSelectedPath(workspacePath));
    }
}
