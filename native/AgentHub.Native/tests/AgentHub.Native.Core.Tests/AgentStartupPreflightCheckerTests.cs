using AgentHub.Native.Core.Profiles;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentStartupPreflightCheckerTests
{
    [Fact]
    public void Allows_plain_shell_without_agent_cli_or_hooks()
    {
        var checker = new AgentStartupPreflightChecker(
            _ => null,
            _ => false,
            _ => false);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.PowerShell, AgentStartupMode.Start),
            HookScriptsDirectory: null,
            HookPythonCommand: null));

        Assert.True(result.Succeeded);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void Reports_missing_agent_cli_for_managed_agent()
    {
        var checker = new AgentStartupPreflightChecker(
            _ => null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Resume),
            @"V:\AgentHub\scripts\hooks",
            "py -3"));

        Assert.False(result.Succeeded);
        Assert.Contains("Agent CLI 'codex' was not found in PATH.", result.Errors);
    }

    [Fact]
    public void Reports_missing_hook_script_for_managed_agent()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command == "codex" || command == "py" ? command : null,
            path => !string.Equals(Path.GetFileName(path), "agenthub_gemini_after_agent.py", StringComparison.Ordinal),
            _ => true);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "py -3"));

        Assert.False(result.Succeeded);
        Assert.Contains(@"AgentHub hook script was not found: V:\AgentHub\scripts\hooks\agenthub_gemini_after_agent.py", result.Errors);
    }

    [Fact]
    public void Reports_missing_python_launcher_for_managed_agent_hooks()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command == "codex" ? command : null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal),
            _ => true);

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "py -3.11"));

        Assert.False(result.Succeeded);
        Assert.Contains("Hook Python launcher 'py' was not found in PATH.", result.Errors);
    }

    [Fact]
    public void Accepts_quoted_python_path_with_arguments()
    {
        var checker = new AgentStartupPreflightChecker(
            command => command is "codex" ? command : null,
            path => RequiredHookFiles().Contains(Path.GetFileName(path), StringComparer.Ordinal)
                || string.Equals(path, @"C:\Program Files\Python311\python.exe", StringComparison.OrdinalIgnoreCase),
            path => string.Equals(path, @"V:\AgentHub\scripts\hooks", StringComparison.OrdinalIgnoreCase));

        var result = checker.Check(new AgentStartupPreflightRequest(
            AgentStartupCommandCatalog.Build(AgentKind.Codex, AgentStartupMode.Start),
            @"V:\AgentHub\scripts\hooks",
            "\"C:\\Program Files\\Python311\\python.exe\" -I"));

        Assert.True(result.Succeeded);
        Assert.Empty(result.Errors);
    }

    private static IReadOnlySet<string> RequiredHookFiles()
    {
        return new HashSet<string>(StringComparer.Ordinal)
        {
            "agenthub_hook_common.py",
            "agenthub_codex_stop.py",
            "agenthub_claude_stop.py",
            "agenthub_gemini_after_agent.py"
        };
    }
}
