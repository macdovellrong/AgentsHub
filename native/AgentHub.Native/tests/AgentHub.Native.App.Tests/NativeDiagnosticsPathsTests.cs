namespace AgentHub.Native.App.Tests;

public sealed class NativeDiagnosticsPathsTests
{
    [Fact]
    public void Resolve_data_directory_uses_local_app_data_when_available()
    {
        var directory = NativeDiagnosticsPaths.ResolveDataDirectory(
            @"C:\Users\saber\AppData\Local",
            @"C:\AgentHub");

        Assert.Equal(
            @"C:\Users\saber\AppData\Local\AgentHub\Native",
            directory);
    }

    [Fact]
    public void Resolve_data_directory_falls_back_to_app_base_when_local_app_data_is_missing()
    {
        var directory = NativeDiagnosticsPaths.ResolveDataDirectory(
            "",
            @"C:\AgentHub");

        Assert.Equal(
            @"C:\AgentHub\.agenthub-native",
            directory);
    }

    [Fact]
    public void Resolve_hook_log_path_points_inside_data_directory()
    {
        var hookLogPath = NativeDiagnosticsPaths.ResolveHookLogPath(@"C:\AgentHub\Native");

        Assert.Equal(
            @"C:\AgentHub\Native\hooks.jsonl",
            hookLogPath);
    }
}
