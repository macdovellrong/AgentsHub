using AgentHub.Native.Core.Collaboration;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentHubCommandParserTests
{
    [Fact]
    public void Parses_send_message_command_block()
    {
        const string text =
            "Delegating work:\n<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"Please inspect.\",\"team_id\":\"default\",\"task_id\":\"T-001\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        var command = Assert.Single(result.SendMessages);
        Assert.Equal("codex", command.To);
        Assert.Equal("Please inspect.", command.Message);
        Assert.Equal("default", command.TeamId);
        Assert.Equal("T-001", command.TaskId);
    }

    [Fact]
    public void Parses_legacy_send_command_block_as_send_message()
    {
        const string text =
            "<agenthub>{\"action\":\"send\",\"target\":\"gemini\",\"task_id\":\"T-002\",\"message\":\"Review this.\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        var command = Assert.Single(result.SendMessages);
        Assert.Equal("gemini", command.To);
        Assert.Equal("Review this.", command.Message);
        Assert.Equal("T-002", command.TaskId);
        Assert.Null(command.TeamId);
    }

    [Fact]
    public void Allows_agenthub_close_tag_inside_json_strings()
    {
        const string text =
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",\"message\":\"literal </agenthub> text\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        Assert.Equal("literal </agenthub> text", Assert.Single(result.SendMessages).Message);
    }

    [Fact]
    public void Returns_errors_for_invalid_blocks_without_throwing()
    {
        const string text =
            "<agenthub>{\"action\":\"send_message\",\"to\":\"codex\",</agenthub>\n<agenthub>{\"action\":\"launch\",\"to\":\"codex\",\"message\":\"Run\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.SendMessages);
        Assert.Equal(["invalid_json", "invalid_action"], result.Errors.Select(error => error.Code).ToArray());
    }

    [Theory]
    [InlineData("<agenthub>{\"action\":\"send_message\",\"message\":\"Missing target\"}</agenthub>", "send_message command requires string field \"to\"")]
    [InlineData("<agenthub>{\"action\":\"send_message\",\"to\":\"codex\"}</agenthub>", "send_message command requires string field \"message\"")]
    [InlineData("<agenthub>{\"action\":\"send_message\",\"to\":\"   \",\"message\":\"Run\"}</agenthub>", "send_message command requires string field \"to\"")]
    [InlineData("<agenthub>{\"action\":\"send\",\"task_id\":\"T-001\",\"message\":\"Missing target\"}</agenthub>", "send command requires string field \"target\"")]
    [InlineData("<agenthub>{\"action\":\"send\",\"target\":\"codex\",\"message\":\"Missing task\"}</agenthub>", "send command requires string field \"task_id\"")]
    [InlineData("<agenthub>{\"action\":\"send\",\"target\":\"codex\",\"task_id\":\"T-001\"}</agenthub>", "send command requires string field \"message\"")]
    public void Rejects_invalid_send_message_commands(string text, string expectedMessage)
    {
        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.SendMessages);
        var error = Assert.Single(result.Errors);
        Assert.Equal("invalid_command", error.Code);
        Assert.Equal(expectedMessage, error.Message);
    }
}
