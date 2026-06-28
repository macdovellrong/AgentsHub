using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Settings;

public sealed record NativeAppSettings(ShellKind HostShell)
{
    public static NativeAppSettings Default { get; } = new(ShellKind.PowerShell);
}
