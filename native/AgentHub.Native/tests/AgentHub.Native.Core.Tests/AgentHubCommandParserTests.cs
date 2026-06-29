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
    public void Parses_workflow_status_commands_without_routing_them()
    {
        const string text =
            "<agenthub>{\"action\":\"ask_user\",\"message\":\"Which workspace should I use?\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"done\",\"message\":\"Finished the requested task\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"done\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        Assert.Empty(result.SendMessages);
        Assert.Collection(
            result.WorkflowCommands,
            command =>
            {
                Assert.Equal("ask_user", command.Action);
                Assert.Equal("Which workspace should I use?", command.Message);
            },
            command =>
            {
                Assert.Equal("done", command.Action);
                Assert.Equal("Finished the requested task", command.Message);
            },
            command =>
            {
                Assert.Equal("done", command.Action);
                Assert.Null(command.Message);
            });
    }

    [Fact]
    public void Parses_pair_negotiation_commands_without_routing_them()
    {
        const string text =
            "<agenthub>{\"action\":\"continue\",\"proposal_version\":2,\"message\":\"Please review version 2.\",\"message_to\":\"codex\",\"summary\":\"Version 2 adds tests.\",\"stance\":\"revise\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"accept\",\"proposal_version\":2,\"summary\":\"Version 2 is ready.\",\"artifact_path\":\"negotiation/proposal-v2.md\",\"stance\":\"accepted\"}</agenthub>\n" +
            "<agenthub>{\"action\":\"continue\",\"proposal_version\":3,\"artifact_path\":\"negotiation/proposal-v3.md\",\"message_to\":\"claude\",\"summary\":\"Version 3 is attached.\"}</agenthub>";

        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.Errors);
        Assert.Empty(result.SendMessages);
        Assert.Collection(
            result.PairNegotiationCommands,
            command =>
            {
                Assert.Equal("continue", command.Action);
                Assert.Equal(2, command.ProposalVersion);
                Assert.Equal("Please review version 2.", command.Message);
                Assert.Null(command.ArtifactPath);
                Assert.Equal("codex", command.MessageTo);
                Assert.Equal("Version 2 adds tests.", command.Summary);
                Assert.Equal("revise", command.Stance);
            },
            command =>
            {
                Assert.Equal("accept", command.Action);
                Assert.Equal(2, command.ProposalVersion);
                Assert.Null(command.Message);
                Assert.Equal("negotiation/proposal-v2.md", command.ArtifactPath);
                Assert.Null(command.MessageTo);
                Assert.Equal("Version 2 is ready.", command.Summary);
                Assert.Equal("accepted", command.Stance);
            },
            command =>
            {
                Assert.Equal("continue", command.Action);
                Assert.Equal(3, command.ProposalVersion);
                Assert.Null(command.Message);
                Assert.Equal("negotiation/proposal-v3.md", command.ArtifactPath);
                Assert.Equal("claude", command.MessageTo);
                Assert.Equal("Version 3 is attached.", command.Summary);
                Assert.Null(command.Stance);
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
    [InlineData("<agenthub>{\"action\":\"ask_user\"}</agenthub>", "ask_user command requires string field \"message\"")]
    [InlineData("<agenthub>{\"action\":\"done\",\"message\":true}</agenthub>", "done command optional field \"message\" must be a string")]
    [InlineData("<agenthub>{\"action\":\"continue\",\"message\":\"Missing proposal version\"}</agenthub>", "continue command requires numeric field \"proposal_version\"")]
    [InlineData("<agenthub>{\"action\":\"continue\",\"proposal_version\":1}</agenthub>", "continue command requires string field \"message\" or \"artifact_path\"")]
    [InlineData("<agenthub>{\"action\":\"continue\",\"proposal_version\":1,\"message\":12}</agenthub>", "continue command requires string field \"message\" or \"artifact_path\"")]
    [InlineData("<agenthub>{\"action\":\"continue\",\"proposal_version\":1,\"message\":\"Review\",\"stance\":true}</agenthub>", "continue command optional field \"stance\" must be a string")]
    [InlineData("<agenthub>{\"action\":\"accept\",\"proposal_version\":1}</agenthub>", "accept command requires string field \"summary\"")]
    [InlineData("<agenthub>{\"action\":\"accept\",\"proposal_version\":\"1\",\"summary\":\"Wrong type\"}</agenthub>", "accept command requires numeric field \"proposal_version\"")]
    [InlineData("<agenthub>{\"action\":\"accept\",\"proposal_version\":1,\"summary\":\"Accepted\",\"artifact_path\":false}</agenthub>", "accept command optional field \"artifact_path\" must be a string")]
    public void Rejects_invalid_send_message_commands(string text, string expectedMessage)
    {
        var result = AgentHubCommandParser.Parse(text);

        Assert.Empty(result.SendMessages);
        var error = Assert.Single(result.Errors);
        Assert.Equal("invalid_command", error.Code);
        Assert.Equal(expectedMessage, error.Message);
    }
}
