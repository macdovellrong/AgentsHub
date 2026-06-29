using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentProfileTargetResolverTests
{
    [Theory]
    [InlineData("codex", "codex")]
    [InlineData("Claude", "claude")]
    [InlineData(" gemini ", "gemini")]
    public void Resolves_single_profile_target(string raw, string expected)
    {
        var profileIds = AgentProfileTargetResolver.Resolve(raw);

        Assert.Equal([expected], profileIds);
    }

    [Fact]
    public void Resolves_agents_alias_to_managed_profiles()
    {
        var profileIds = AgentProfileTargetResolver.Resolve("agents");

        Assert.Equal(["codex", "claude", "gemini"], profileIds);
    }
}
