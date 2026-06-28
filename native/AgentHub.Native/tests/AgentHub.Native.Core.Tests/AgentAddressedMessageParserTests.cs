using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentAddressedMessageParserTests
{
    [Theory]
    [InlineData("@codex please review", "codex", "please review")]
    [InlineData("  @Claude   check this  ", "claude", "check this")]
    [InlineData("@gemini: summarize", "gemini", "summarize")]
    [InlineData("@cmd dir", "cmd", "dir")]
    public void Parses_profile_prefix(string raw, string expectedProfileId, string expectedMessage)
    {
        var parsed = AgentAddressedMessageParser.Parse(raw);

        Assert.NotNull(parsed);
        Assert.Equal(expectedProfileId, parsed.ProfileId);
        Assert.Equal(expectedMessage, parsed.Message);
    }

    [Theory]
    [InlineData("plain text")]
    [InlineData("@codex")]
    [InlineData("@codex   ")]
    [InlineData("@bad-target hello")]
    public void Returns_null_when_text_is_not_an_addressed_message(string raw)
    {
        Assert.Null(AgentAddressedMessageParser.Parse(raw));
    }
}
