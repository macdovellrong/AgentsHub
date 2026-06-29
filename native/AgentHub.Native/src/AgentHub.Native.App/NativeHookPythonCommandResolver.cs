namespace AgentHub.Native.App;

public static class NativeHookPythonCommandResolver
{
    public const string DefaultCommand = "py -3.11";

    public static string Resolve(string? startupCommand)
    {
        return string.IsNullOrWhiteSpace(startupCommand)
            ? DefaultCommand
            : startupCommand.Trim();
    }
}
