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
}
