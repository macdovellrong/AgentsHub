using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Settings;

public sealed record NativeAppStartupAgent(AgentKind AgentKind, AgentStartupMode Mode);
