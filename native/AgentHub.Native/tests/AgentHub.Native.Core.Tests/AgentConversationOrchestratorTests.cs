using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class AgentConversationOrchestratorTests : IDisposable
{
    private readonly string tempRoot = Path.Combine(
        Path.GetTempPath(),
        "agenthub-native-conversation-orchestrator",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task Starts_manager_conversation_by_sending_prompt_to_latest_supervisor_session()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore(new AgentConversationStoreOptions
        {
            UtcNow = () => DateTimeOffset.Parse("2026-06-29T12:34:56Z")
        });
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var olderSession = new RecordingTerminalSession("claude-old");
        var latestSession = new RecordingTerminalSession("claude-latest");
        inputRouter.Register(olderSession);
        inputRouter.Register(latestSession);
        registry.Register(new AgentSessionDescriptor("claude-old", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:00:00Z")));
        registry.Register(new AgentSessionDescriptor("claude-latest", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var conversation = await orchestrator.StartManagerAsync(new StartAgentManagerConversationRequest(
            workspacePath,
            "Implement native orchestration",
            ["codex", "gemini"],
            ConversationId: "conversation-1"));

        Assert.Equal("conversation-1", conversation.Id);
        Assert.Equal("manager", conversation.Mode);
        Assert.Equal("running", conversation.Status);
        Assert.Equal("claude", conversation.SupervisorProfileId);
        Assert.Equal(["codex", "gemini"], conversation.ParticipantProfileIds);
        Assert.Equal(1, conversation.CurrentStep);
        Assert.Equal(12, conversation.MaxSteps);
        Assert.Empty(olderSession.Writes);
        Assert.Equal("\x1b[200~", latestSession.Writes[0]);
        Assert.Contains("AgentHub manager conversation.", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: conversation-1", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Topic: Implement native orchestration", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Participants: codex, gemini", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("<agenthub>{\"action\":\"send\"", latestSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", latestSession.Writes[2]);
        Assert.Equal("\r", latestSession.Writes[3]);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("claude", item.TargetProfileId);
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Contains("Manager conversation started", item.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Marks_manager_conversation_failed_when_supervisor_session_is_missing()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var orchestrator = new AgentConversationOrchestrator(
            conversationStore,
            timelineStore,
            new AgentInputRouter(),
            new AgentSessionRegistry());

        var conversation = await orchestrator.StartManagerAsync(new StartAgentManagerConversationRequest(
            workspacePath,
            "Implement native orchestration",
            ["codex"],
            ConversationId: "conversation-1"));

        Assert.Equal("failed", conversation.Status);
        Assert.Equal(0, conversation.CurrentStep);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal("failed", latest.Status);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.AgentHubCommandError, item.Kind);
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Contains("No active session for profile 'claude'", item.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Routes_supervisor_send_command_to_target_participant_session()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var supervisorSession = new RecordingTerminalSession("claude-1");
        var targetSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(supervisorSession);
        inputRouter.Register(targetSession);
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);
        var conversation = await orchestrator.StartManagerAsync(new StartAgentManagerConversationRequest(
            workspacePath,
            "Implement native orchestration",
            ["codex"],
            ConversationId: "conversation-1"));

        await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"send\",\"target\":\"codex\",\"task_id\":\"T-001\",\"message\":\"Implement parser.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude",
            ConversationId: conversation.Id));

        Assert.Equal("\x1b[200~", targetSession.Writes[0]);
        Assert.Contains("AgentHub delegated task.", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: conversation-1", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Task: T-001", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Implement parser.", targetSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", targetSession.Writes[2]);
        Assert.Equal("\r", targetSession.Writes[3]);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal(2, latest.CurrentStep);
        var events = await timelineStore.ListAsync(workspacePath);
        Assert.Equal(2, events.Count);
        var delegated = events[^1];
        Assert.Equal(CollaborationEventKind.UserMessage, delegated.Kind);
        Assert.Equal("agenthub", delegated.ProfileId);
        Assert.Equal("codex", delegated.TargetProfileId);
        Assert.Equal("conversation-1", delegated.ConversationId);
        Assert.Equal("T-001", delegated.TaskId);
        Assert.Equal("codex-1", delegated.SessionId);
        Assert.Equal("Implement parser.", delegated.Message);
    }

    [Fact]
    public async Task Completes_manager_conversation_from_supervisor_done_command()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "conversation-1",
                "manager",
                "claude",
                ["codex"],
                "Implement native orchestration",
                CurrentStep: 2,
                MaxSteps: 12));
        var orchestrator = new AgentConversationOrchestrator(
            conversationStore,
            timelineStore,
            new AgentInputRouter(),
            new AgentSessionRegistry());

        await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"done\",\"message\":\"Finished.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude",
            ConversationId: "conversation-1"));

        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal("completed", latest.Status);
        Assert.Equal(2, latest.CurrentStep);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("workflow", item.TargetProfileId);
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Equal("[done] Finished.", item.Message);
    }

    [Fact]
    public async Task Pauses_manager_conversation_from_supervisor_ask_user_command()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "conversation-1",
                "manager",
                "claude",
                ["codex"],
                "Implement native orchestration",
                CurrentStep: 2,
                MaxSteps: 12));
        var orchestrator = new AgentConversationOrchestrator(
            conversationStore,
            timelineStore,
            new AgentInputRouter(),
            new AgentSessionRegistry());

        await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"ask_user\",\"message\":\"Which option should I use?\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude",
            ConversationId: "conversation-1"));

        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal("paused", latest.Status);
        Assert.Equal(2, latest.CurrentStep);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("workflow", item.TargetProfileId);
        Assert.Equal("conversation-1", item.ConversationId);
        Assert.Equal("[ask_user] Which option should I use?", item.Message);
    }

    [Fact]
    public async Task Sends_participant_task_observation_back_to_supervisor()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var supervisorSession = new RecordingTerminalSession("claude-1");
        inputRouter.Register(supervisorSession);
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "conversation-1",
                "manager",
                "claude",
                ["codex"],
                "Implement native orchestration",
                CurrentStep: 2,
                MaxSteps: 12));
        await timelineStore.AppendUserMessageAsync(new CollaborationUserMessage(
            workspacePath,
            "agenthub",
            "codex",
            "Implement parser.",
            ConversationId: "conversation-1",
            TaskId: "T-001",
            SessionId: "codex-1"));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var handled = await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "Implemented parser and added tests.",
            "codex",
            "codex-1",
            "run-2",
            "codex",
            TaskId: "T-001",
            ConversationId: "conversation-1"));

        Assert.True(handled);
        Assert.Equal("\x1b[200~", supervisorSession.Writes[0]);
        Assert.Contains("Observation from codex.", supervisorSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: conversation-1", supervisorSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Task: T-001", supervisorSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Implemented parser and added tests.", supervisorSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", supervisorSession.Writes[2]);
        Assert.Equal("\r", supervisorSession.Writes[3]);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal(3, latest.CurrentStep);
        var events = await timelineStore.ListAsync(workspacePath);
        Assert.Equal(2, events.Count);
        var observation = events[^1];
        Assert.Equal(CollaborationEventKind.UserMessage, observation.Kind);
        Assert.Equal("agenthub", observation.ProfileId);
        Assert.Equal("claude", observation.TargetProfileId);
        Assert.Equal("conversation-1", observation.ConversationId);
        Assert.Equal("T-001", observation.TaskId);
        Assert.Equal("claude-1", observation.SessionId);
        Assert.Equal("Implemented parser and added tests.", observation.Message);
    }

    [Fact]
    public async Task Starts_roundtable_conversation_by_sending_prompt_to_first_ordered_participant()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var claudeSession = new RecordingTerminalSession("claude-1");
        var codexSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(claudeSession);
        inputRouter.Register(codexSession);
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var conversation = await orchestrator.StartRoundtableAsync(new StartRoundtableConversationRequest(
            workspacePath,
            "Compare native terminal options",
            ["codex", "claude"],
            ConversationId: "roundtable-1",
            MaxRounds: 1));

        Assert.Equal("roundtable-1", conversation.Id);
        Assert.Equal("roundtable", conversation.Mode);
        Assert.Equal("running", conversation.Status);
        Assert.Null(conversation.SupervisorProfileId);
        Assert.Equal(["claude", "codex"], conversation.ParticipantProfileIds);
        Assert.Equal(1, conversation.CurrentStep);
        Assert.Equal(3, conversation.MaxSteps);
        Assert.Equal("\x1b[200~", claudeSession.Writes[0]);
        Assert.Contains("AgentHub roundtable conversation.", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: roundtable-1", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Topic: Compare native terminal options", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Participants: claude -> codex", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", claudeSession.Writes[2]);
        Assert.Equal("\r", claudeSession.Writes[3]);
        Assert.Empty(codexSession.Writes);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("claude", item.TargetProfileId);
        Assert.Equal("roundtable-1", item.ConversationId);
        Assert.Contains("Roundtable conversation started", item.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Forwards_roundtable_output_to_next_participant()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var codexSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(codexSession);
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "roundtable-1",
                "roundtable",
                null,
                ["claude", "codex"],
                "Compare native terminal options",
                CurrentStep: 1,
                MaxSteps: 3));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var handled = await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "Claude view: prefer native host.",
            "claude",
            "claude-1",
            "run-1",
            "claude",
            ConversationId: "roundtable-1"));

        Assert.True(handled);
        Assert.Equal("\x1b[200~", codexSession.Writes[0]);
        Assert.Contains("AgentHub roundtable conversation.", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: roundtable-1", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Previous speaker: claude", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Claude view: prefer native host.", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", codexSession.Writes[2]);
        Assert.Equal("\r", codexSession.Writes[3]);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal(2, latest.CurrentStep);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("codex", item.TargetProfileId);
        Assert.Equal("roundtable-1", item.ConversationId);
        Assert.Equal("Claude view: prefer native host.", item.Message);
    }

    [Fact]
    public async Task Completes_roundtable_when_max_steps_are_reached()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "roundtable-1",
                "roundtable",
                null,
                ["claude", "codex"],
                "Compare native terminal options",
                CurrentStep: 3,
                MaxSteps: 3));
        var orchestrator = new AgentConversationOrchestrator(
            conversationStore,
            timelineStore,
            new AgentInputRouter(),
            new AgentSessionRegistry());

        var handled = await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "Final summary.",
            "claude",
            "claude-1",
            "run-3",
            "claude",
            ConversationId: "roundtable-1"));

        Assert.True(handled);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal("completed", latest.Status);
        Assert.Equal(3, latest.CurrentStep);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("workflow", item.TargetProfileId);
        Assert.Equal("roundtable-1", item.ConversationId);
        Assert.Equal("[roundtable_completed] Final summary.", item.Message);
    }

    [Fact]
    public async Task Starts_pair_negotiation_conversation_by_sending_prompt_to_first_participant()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var claudeSession = new RecordingTerminalSession("claude-1");
        var codexSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(claudeSession);
        inputRouter.Register(codexSession);
        registry.Register(new AgentSessionDescriptor("claude-1", "claude", workspacePath, DateTimeOffset.Parse("2026-06-29T10:01:00Z")));
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var conversation = await orchestrator.StartPairNegotiationAsync(new StartPairNegotiationConversationRequest(
            workspacePath,
            "Agree on native terminal architecture",
            ["claude", "codex"],
            ConversationId: "pair-1",
            MaxRounds: 2));

        Assert.Equal("pair-1", conversation.Id);
        Assert.Equal("pair_negotiation", conversation.Mode);
        Assert.Equal("running", conversation.Status);
        Assert.Equal(["claude", "codex"], conversation.ParticipantProfileIds);
        Assert.Equal(1, conversation.CurrentStep);
        Assert.Equal(4, conversation.MaxSteps);
        Assert.Equal("\x1b[200~", claudeSession.Writes[0]);
        Assert.Contains("AgentHub pair negotiation conversation.", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: pair-1", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Topic: Agree on native terminal architecture", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Participants: claude <-> codex", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("\"action\":\"continue\"", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("\"action\":\"accept\"", claudeSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", claudeSession.Writes[2]);
        Assert.Equal("\r", claudeSession.Writes[3]);
        Assert.Empty(codexSession.Writes);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal(CollaborationEventKind.UserMessage, item.Kind);
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("claude", item.TargetProfileId);
        Assert.Equal("pair-1", item.ConversationId);
        Assert.Contains("Pair negotiation started", item.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Continues_pair_negotiation_to_the_other_participant()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        var inputRouter = new AgentInputRouter();
        var registry = new AgentSessionRegistry();
        var codexSession = new RecordingTerminalSession("codex-1");
        inputRouter.Register(codexSession);
        registry.Register(new AgentSessionDescriptor("codex-1", "codex", workspacePath, DateTimeOffset.Parse("2026-06-29T10:02:00Z")));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "pair-1",
                "pair_negotiation",
                null,
                ["claude", "codex"],
                "Agree on native terminal architecture",
                CurrentStep: 1,
                MaxSteps: 4));
        var orchestrator = new AgentConversationOrchestrator(conversationStore, timelineStore, inputRouter, registry);

        var handled = await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"continue\",\"proposal_version\":1,\"summary\":\"Use native host.\",\"message\":\"Please review the native host plan.\"}</agenthub>",
            "claude",
            "claude-1",
            "run-1",
            "claude",
            ConversationId: "pair-1"));

        Assert.True(handled);
        Assert.Equal("\x1b[200~", codexSession.Writes[0]);
        Assert.Contains("AgentHub pair negotiation conversation.", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Conversation: pair-1", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Previous speaker: claude", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Proposal version: 1", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Use native host.", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Contains("Please review the native host plan.", codexSession.Writes[1], StringComparison.Ordinal);
        Assert.Equal("\x1b[201~", codexSession.Writes[2]);
        Assert.Equal("\r", codexSession.Writes[3]);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal(2, latest.CurrentStep);
        var item = Assert.Single(await timelineStore.ListAsync(workspacePath));
        Assert.Equal("agenthub", item.ProfileId);
        Assert.Equal("codex", item.TargetProfileId);
        Assert.Equal("pair-1", item.ConversationId);
        Assert.Equal("[continue v1] Use native host.", item.Message);
    }

    [Fact]
    public async Task Completes_pair_negotiation_when_both_participants_accept_same_version()
    {
        var workspacePath = CreateWorkspace();
        var conversationStore = new AgentConversationStore();
        var timelineStore = new CollaborationEventStore(Path.Combine(tempRoot, "events"));
        await conversationStore.CreateAsync(
            workspacePath,
            new CreateAgentConversationRequest(
                "pair-1",
                "pair_negotiation",
                null,
                ["claude", "codex"],
                "Agree on native terminal architecture",
                CurrentStep: 2,
                MaxSteps: 4));
        await timelineStore.AppendUserMessageAsync(new CollaborationUserMessage(
            workspacePath,
            "claude",
            "pair-negotiation",
            "[accept v2] Claude accepts.",
            ConversationId: "pair-1"));
        var orchestrator = new AgentConversationOrchestrator(
            conversationStore,
            timelineStore,
            new AgentInputRouter(),
            new AgentSessionRegistry());

        var handled = await orchestrator.HandleAgentOutputAsync(new AgentHookEvent(
            workspacePath,
            "<agenthub>{\"action\":\"accept\",\"proposal_version\":2,\"summary\":\"Codex also accepts.\"}</agenthub>",
            "codex",
            "codex-1",
            "run-2",
            "codex",
            ConversationId: "pair-1"));

        Assert.True(handled);
        var latest = Assert.Single(await conversationStore.ListAsync(workspacePath));
        Assert.Equal("completed", latest.Status);
        Assert.Equal(2, latest.CurrentStep);
        var events = await timelineStore.ListAsync(workspacePath);
        Assert.Equal(3, events.Count);
        Assert.Equal("codex", events[1].ProfileId);
        Assert.Equal("pair-negotiation", events[1].TargetProfileId);
        Assert.Equal("[accept v2] Codex also accepts.", events[1].Message);
        Assert.Equal("agenthub", events[2].ProfileId);
        Assert.Equal("workflow", events[2].TargetProfileId);
        Assert.Equal("[pair_negotiation_completed v2] Codex also accepts.", events[2].Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempRoot))
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }

    private string CreateWorkspace()
    {
        var workspacePath = Path.Combine(tempRoot, "workspace-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspacePath);
        return workspacePath;
    }

    private sealed class RecordingTerminalSession(string id) : IAgentTerminalSession
    {
        public string Id { get; } = id;
        public List<string> Writes { get; } = [];

        public Task WriteAsync(string text, CancellationToken cancellationToken = default)
        {
            Writes.Add(text);
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken = default)
        {
            return Task.CompletedTask;
        }
    }
}
