using AgentHub.Native.App;

namespace AgentHub.Native.App.Tests;

public sealed class NativeHookPythonCommandResolverTests
{
    [Fact]
    public void Uses_python_311_launcher_by_default()
    {
        Assert.Equal("py -3.11", NativeHookPythonCommandResolver.Resolve(null));
        Assert.Equal("py -3.11", NativeHookPythonCommandResolver.Resolve("   "));
    }

    [Fact]
    public void Preserves_explicit_startup_python_command()
    {
        Assert.Equal(
            @"C:\Program Files\Python311\python.exe",
            NativeHookPythonCommandResolver.Resolve(@"C:\Program Files\Python311\python.exe"));
    }
}
