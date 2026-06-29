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

    [Theory]
    [InlineData("assign_task", "codex", "Implement T001")]
    [InlineData("reject_task", "codex", "Add tests")]
    [InlineData("request_review", "gemini", "Review risk")]
    public void Parses_task_plan_routing_commands_as_send_messages(string action, string expectedTarget, string expectedMessage)
    {
        var text =
            $"<agenthub>{{\"action\":\"{action}\",\"plan_id\":\"P001\",\"task_id\":\"T001\",\"to\":\"{expectedTarget}\",\"message\":\"{expectedMessage}\"}}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        var command = Assert.Single(result.SendMessages);
        Assert.Equal(expectedTarget, command.To);
        Assert.Equal(expectedMessage, command.Message);
        Assert.Equal("P001", command.PlanId);
        Assert.Equal("T001", command.TaskId);
    }

    [Fact]
    public void Parses_task_plan_status_commands_without_routing_them()
    {
        const string text =
            "<agenthub>{\"action\":\"approve_task\",\"plan_id\":\"P001\",\"task_id\":\"T001\",\"summary\":\"Looks good\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"pause_plan\",\"plan_id\":\"P001\",\"reason\":\"Need user decision\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        Assert.Empty(result.SendMessages);
        Assert.Collection(
            result.PlanStatusCommands,
            command =>
            {
                Assert.Equal("approve_task", command.Action);
                Assert.Equal("P001", command.PlanId);
                Assert.Equal("T001", command.TaskId);
                Assert.Equal("Looks good", command.Message);
            },
            command =>
            {
                Assert.Equal("pause_plan", command.Action);
                Assert.Equal("P001", command.PlanId);
                Assert.Null(command.TaskId);
                Assert.Equal("Need user decision", command.Message);
            });
    }

    [Fact]
    public void Parses_provider_neutral_team_status_commands_without_routing_them()
    {
        const string text =
            "<agenthub>{\"action\":\"claim_task\",\"task_id\":\"T-001\",\"team_id\":\"default\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"complete_task\",\"task_id\":\"T-001\",\"summary\":\"Implementation finished.\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        Assert.Empty(result.SendMessages);
        Assert.Collection(
            result.TeamStatusCommands,
            command =>
            {
                Assert.Equal("claim_task", command.Action);
                Assert.Equal("default", command.TeamId);
                Assert.Equal("T-001", command.TaskId);
                Assert.Null(command.Summary);
            },
            command =>
            {
                Assert.Equal("complete_task", command.Action);
                Assert.Equal("default", command.TeamId);
                Assert.Equal("T-001", command.TaskId);
                Assert.Equal("Implementation finished.", command.Summary);
            });
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
    [InlineData("<agenthub>{\"action\":\"assign_task\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"Missing plan\"}</agenthub>", "assign_task command requires string field \"plan_id\"")]
    [InlineData("<agenthub>{\"action\":\"reject_task\",\"plan_id\":\"P001\",\"to\":\"codex\",\"message\":\"Missing task\"}</agenthub>", "reject_task command requires string field \"task_id\"")]
    [InlineData("<agenthub>{\"action\":\"request_review\",\"plan_id\":\"P001\",\"task_id\":\"T001\",\"message\":\"Missing target\"}</agenthub>", "request_review command requires string field \"to\"")]
    [InlineData("<agenthub>{\"action\":\"claim_task\"}</agenthub>", "claim_task command requires string field \"task_id\"")]
    [InlineData("<agenthub>{\"action\":\"complete_task\",\"task_id\":\"T-001\",\"summary\":12}</agenthub>", "complete_task command optional field \"summary\" must be a string")]
    public void Rejects_invalid_send_message_commands(string text, string expectedMessage)
    {
        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.SendMessages);
        var error = Assert.Single(result.Errors);
        Assert.Equal("invalid_command", error.Code);
        Assert.Equal(expectedMessage, error.Message);
    }
}
