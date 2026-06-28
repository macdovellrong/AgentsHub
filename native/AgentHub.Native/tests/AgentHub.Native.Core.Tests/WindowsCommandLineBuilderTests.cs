using AgentHub.Native.Core.Processes;

namespace AgentHub.Native.Core.Tests;

public sealed class WindowsCommandLineBuilderTests
{
    [Fact]
    public void Builds_command_line_with_quoted_executable_and_arguments()
    {
        var commandLine = WindowsCommandLineBuilder.Build(
            @"C:\Program Files\PowerShell\7\pwsh.exe",
            ["-NoLogo", "-Command", "Write-Host \"hello world\""]);

        Assert.Equal(
            "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -NoLogo -Command \"Write-Host \\\"hello world\\\"\"",
            commandLine);
    }

    [Fact]
    public void Doubles_trailing_backslashes_before_closing_quote()
    {
        var commandLine = WindowsCommandLineBuilder.Build(
            @"C:\Program Files\AgentHub\AgentHub.Native.App.exe",
            [@"C:\Users\saber\Project With Space\"]);

        Assert.Equal(
            "\"C:\\Program Files\\AgentHub\\AgentHub.Native.App.exe\" \"C:\\Users\\saber\\Project With Space\\\\\"",
            commandLine);
    }

    [Fact]
    public void Preserves_backslashes_before_embedded_quotes()
    {
        var commandLine = WindowsCommandLineBuilder.Build(
            "codex",
            ["say \\\"hello\\\""]);

        Assert.Equal("codex \"say \\\\\\\"hello\\\\\\\"\"", commandLine);
    }
}
