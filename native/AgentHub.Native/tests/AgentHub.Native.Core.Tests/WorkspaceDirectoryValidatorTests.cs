using AgentHub.Native.Core.Workspaces;

namespace AgentHub.Native.Core.Tests;

public sealed class WorkspaceDirectoryValidatorTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(Path.GetTempPath(), "agenthub-native-workspace-validation", Guid.NewGuid().ToString("N"));

    [Fact]
    public void Accepts_existing_directory_and_normalizes_path()
    {
        var workspace = Path.Combine(tempRoot, "OrderManager");
        Directory.CreateDirectory(workspace);

        var result = WorkspaceDirectoryValidator.Validate($"{workspace}{Path.DirectorySeparatorChar}");

        Assert.True(result.IsValid);
        Assert.Equal(workspace, result.Path);
        Assert.Null(result.ErrorMessage);
    }

    [Fact]
    public void Rejects_empty_path()
    {
        var result = WorkspaceDirectoryValidator.Validate("   ");

        Assert.False(result.IsValid);
        Assert.Null(result.Path);
        Assert.Equal("Select a workspace directory first.", result.ErrorMessage);
    }

    [Fact]
    public void Rejects_missing_directory()
    {
        var missing = Path.Combine(tempRoot, "Missing");

        var result = WorkspaceDirectoryValidator.Validate(missing);

        Assert.False(result.IsValid);
        Assert.Null(result.Path);
        Assert.Equal($"Workspace directory does not exist: {missing}", result.ErrorMessage);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
