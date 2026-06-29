using AgentHub.Native.Core.Input;
using AgentHub.Native.Core.Hooks;
using System.Globalization;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentConversationOrchestrator(
    AgentConversationStore conversationStore,
    CollaborationEventStore timelineStore,
    AgentInputRouter inputRouter,
    AgentSessionRegistry sessionRegistry)
{
    private const int DefaultMaxSteps = 12;
    private const int DefaultMaxRounds = 2;
    private const int DefaultPairNegotiationMaxRounds = 3;
    private static readonly string[] RoundtableProfileOrder = ["claude", "codex", "gemini"];

    public async Task<AgentConversation> StartManagerAsync(
        StartAgentManagerConversationRequest request,
        CancellationToken cancellationToken = default)
    {
        var supervisorProfileId = string.IsNullOrWhiteSpace(request.SupervisorProfileId)
            ? "claude"
            : request.SupervisorProfileId;
        var conversation = await conversationStore.CreateAsync(
            request.WorkspacePath,
            new CreateAgentConversationRequest(
                request.ConversationId,
                "manager",
                supervisorProfileId,
                request.ParticipantProfileIds,
                request.Topic,
                MaxSteps: request.MaxSteps ?? DefaultMaxSteps),
            cancellationToken).ConfigureAwait(false);

        var supervisorSession = sessionRegistry.FindLatest(request.WorkspacePath, supervisorProfileId);
        if (supervisorSession is null)
        {
            var error = $"No active session for profile '{supervisorProfileId}'";
            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                error,
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var prompt = BuildInitialManagerPrompt(conversation);
        var sendResult = await inputRouter.TrySendLineDetailedAsync(supervisorSession.Id, prompt, cancellationToken)
            .ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(supervisorSession.Id);
            }

            var error = $"Unable to send manager conversation prompt to session '{supervisorSession.Id}': {sendResult.Status}";
            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                error,
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var updated = await conversationStore.UpdateAsync(
            request.WorkspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: conversation.CurrentStep + 1),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                request.WorkspacePath,
                "agenthub",
                supervisorProfileId,
                $"Manager conversation started: {conversation.Topic}",
                ConversationId: conversation.Id,
                SessionId: supervisorSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    public async Task<AgentConversation> StartRoundtableAsync(
        StartRoundtableConversationRequest request,
        CancellationToken cancellationToken = default)
    {
        var participants = NormalizeRoundtableParticipants(request.ParticipantProfileIds);
        if (participants.Count == 0)
        {
            throw new InvalidOperationException("Roundtable requires at least one participant.");
        }

        var maxRounds = request.MaxRounds ?? DefaultMaxRounds;
        var conversation = await conversationStore.CreateAsync(
            request.WorkspacePath,
            new CreateAgentConversationRequest(
                request.ConversationId,
                "roundtable",
                null,
                participants,
                request.Topic,
                MaxSteps: participants.Count * maxRounds + 1),
            cancellationToken).ConfigureAwait(false);
        var firstProfileId = conversation.ParticipantProfileIds[0];
        var firstSession = sessionRegistry.FindLatest(request.WorkspacePath, firstProfileId);
        if (firstSession is null)
        {
            var error = $"No active session for profile '{firstProfileId}'";
            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                error,
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            firstSession.Id,
            BuildInitialRoundtablePrompt(conversation),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(firstSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                $"Unable to send roundtable conversation prompt to session '{firstSession.Id}': {sendResult.Status}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var updated = await conversationStore.UpdateAsync(
            request.WorkspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: conversation.CurrentStep + 1),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                request.WorkspacePath,
                "agenthub",
                firstProfileId,
                $"Roundtable conversation started: {conversation.Topic}",
                ConversationId: conversation.Id,
                SessionId: firstSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    public async Task<AgentConversation> StartPairNegotiationAsync(
        StartPairNegotiationConversationRequest request,
        CancellationToken cancellationToken = default)
    {
        var participants = NormalizePairNegotiationParticipants(request.ParticipantProfileIds);
        var maxRounds = request.MaxRounds ?? DefaultPairNegotiationMaxRounds;
        var conversation = await conversationStore.CreateAsync(
            request.WorkspacePath,
            new CreateAgentConversationRequest(
                request.ConversationId,
                "pair_negotiation",
                null,
                participants,
                request.Topic,
                MaxSteps: participants.Count * maxRounds),
            cancellationToken).ConfigureAwait(false);
        var firstProfileId = conversation.ParticipantProfileIds[0];
        var firstSession = sessionRegistry.FindLatest(request.WorkspacePath, firstProfileId);
        if (firstSession is null)
        {
            var error = $"No active session for profile '{firstProfileId}'";
            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                error,
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            firstSession.Id,
            BuildInitialPairNegotiationPrompt(conversation),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(firstSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                request.WorkspacePath,
                $"Unable to send pair negotiation prompt to session '{firstSession.Id}': {sendResult.Status}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                request.WorkspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var updated = await conversationStore.UpdateAsync(
            request.WorkspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: conversation.CurrentStep + 1),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                request.WorkspacePath,
                "agenthub",
                firstProfileId,
                $"Pair negotiation started: {conversation.Topic}",
                ConversationId: conversation.Id,
                SessionId: firstSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    public async Task<bool> CanHandleAgentOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        return await FindManagedConversationOutputAsync(hookEvent, cancellationToken)
                   .ConfigureAwait(false) is not null ||
               await FindRoundtableConversationOutputAsync(hookEvent, cancellationToken)
                   .ConfigureAwait(false) is not null ||
               await FindPairNegotiationConversationOutputAsync(hookEvent, cancellationToken)
                   .ConfigureAwait(false) is not null;
    }

    public async Task<bool> HandleAgentOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        var output = await FindManagedConversationOutputAsync(hookEvent, cancellationToken)
            .ConfigureAwait(false);
        if (output is null)
        {
            var roundtable = await FindRoundtableConversationOutputAsync(hookEvent, cancellationToken)
                .ConfigureAwait(false);
            if (roundtable is null)
            {
                var pairNegotiation = await FindPairNegotiationConversationOutputAsync(hookEvent, cancellationToken)
                    .ConfigureAwait(false);
                if (pairNegotiation is null)
                {
                    return false;
                }

                await RoutePairNegotiationOutputAsync(
                    hookEvent.Workspace,
                    pairNegotiation,
                    hookEvent,
                    cancellationToken).ConfigureAwait(false);
                return true;
            }

            await RouteRoundtableOutputAsync(hookEvent.Workspace, roundtable, hookEvent, cancellationToken)
                .ConfigureAwait(false);
            return true;
        }

        if (!output.IsSupervisor)
        {
            await RouteParticipantObservationAsync(
                hookEvent.Workspace,
                output.Conversation,
                hookEvent,
                output.TaskId,
                cancellationToken).ConfigureAwait(false);
            return true;
        }

        var conversation = output.Conversation;
        var parsed = AgentHubCommandParser.Parse(hookEvent.Message);
        foreach (var error in parsed.Errors)
        {
            await timelineStore.AppendCommandErrorAsync(
                hookEvent.Workspace,
                $"[parse_error {error.Code} #{error.Index}] {error.Message}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in parsed.SendMessages)
        {
            conversation = await RouteManagerSendCommandAsync(
                hookEvent.Workspace,
                conversation,
                command,
                cancellationToken).ConfigureAwait(false);
        }

        foreach (var command in parsed.WorkflowCommands)
        {
            conversation = await ApplyManagerWorkflowCommandAsync(
                hookEvent.Workspace,
                conversation,
                command,
                cancellationToken).ConfigureAwait(false);
        }

        return true;
    }

    private async Task<ManagedConversationOutput?> FindManagedConversationOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hookEvent.ProfileId))
        {
            return null;
        }

        var conversations = await conversationStore.ListAsync(hookEvent.Workspace, cancellationToken)
            .ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(hookEvent.ConversationId))
        {
            var conversation = conversations.FirstOrDefault(item =>
                string.Equals(item.Id, hookEvent.ConversationId, StringComparison.Ordinal) &&
                item.Mode == "manager" &&
                item.Status == "running");
            if (conversation is null)
            {
                return null;
            }

            if (string.Equals(conversation.SupervisorProfileId, hookEvent.ProfileId, StringComparison.OrdinalIgnoreCase))
            {
                return new ManagedConversationOutput(conversation, IsSupervisor: true, TaskId: hookEvent.TaskId);
            }

            if (conversation.ParticipantProfileIds.Contains(hookEvent.ProfileId, StringComparer.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(hookEvent.TaskId) &&
                await HasMatchingDelegatedTaskAsync(
                    hookEvent.Workspace,
                    conversation.Id,
                    hookEvent.ProfileId,
                    hookEvent.TaskId,
                    hookEvent.SessionId,
                    cancellationToken).ConfigureAwait(false))
            {
                return new ManagedConversationOutput(conversation, IsSupervisor: false, hookEvent.TaskId);
            }

            return null;
        }

        return await InferParticipantConversationOutputAsync(
            hookEvent.Workspace,
            hookEvent.ProfileId,
            hookEvent.SessionId,
            conversations,
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<AgentConversation?> FindRoundtableConversationOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hookEvent.ConversationId) ||
            string.IsNullOrWhiteSpace(hookEvent.ProfileId))
        {
            return null;
        }

        var conversation = (await conversationStore.ListAsync(hookEvent.Workspace, cancellationToken)
                .ConfigureAwait(false))
            .FirstOrDefault(item =>
                string.Equals(item.Id, hookEvent.ConversationId, StringComparison.Ordinal) &&
                item.Mode == "roundtable" &&
                item.Status == "running" &&
                item.ParticipantProfileIds.Contains(hookEvent.ProfileId, StringComparer.OrdinalIgnoreCase));
        if (conversation is null)
        {
            return null;
        }

        var expectedProfileId = RoundtableSpeakerForStep(conversation, conversation.CurrentStep);
        return string.Equals(expectedProfileId, hookEvent.ProfileId, StringComparison.OrdinalIgnoreCase)
            ? conversation
            : null;
    }

    private async Task<AgentConversation?> FindPairNegotiationConversationOutputAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hookEvent.ConversationId) ||
            string.IsNullOrWhiteSpace(hookEvent.ProfileId))
        {
            return null;
        }

        var conversation = (await conversationStore.ListAsync(hookEvent.Workspace, cancellationToken)
                .ConfigureAwait(false))
            .FirstOrDefault(item =>
                string.Equals(item.Id, hookEvent.ConversationId, StringComparison.Ordinal) &&
                item.Mode == "pair_negotiation" &&
                item.Status == "running" &&
                item.ParticipantProfileIds.Contains(hookEvent.ProfileId, StringComparer.OrdinalIgnoreCase));
        if (conversation is null)
        {
            return null;
        }

        var expectedProfileId = PairNegotiationSpeakerForStep(conversation, conversation.CurrentStep);
        return string.Equals(expectedProfileId, hookEvent.ProfileId, StringComparison.OrdinalIgnoreCase)
            ? conversation
            : null;
    }

    private async Task<ManagedConversationOutput?> InferParticipantConversationOutputAsync(
        string workspacePath,
        string profileId,
        string? sessionId,
        IReadOnlyList<AgentConversation> conversations,
        CancellationToken cancellationToken)
    {
        var events = await timelineStore.ListAsync(workspacePath, cancellationToken)
            .ConfigureAwait(false);
        foreach (var item in events.Reverse())
        {
            if (item.Kind != CollaborationEventKind.UserMessage ||
                !string.Equals(item.ProfileId, "agenthub", StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(item.TargetProfileId, profileId, StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrWhiteSpace(item.ConversationId) ||
                string.IsNullOrWhiteSpace(item.TaskId) ||
                !SessionMatches(item.SessionId, sessionId))
            {
                continue;
            }

            var conversation = conversations.FirstOrDefault(candidate =>
                string.Equals(candidate.Id, item.ConversationId, StringComparison.Ordinal) &&
                candidate.Mode == "manager" &&
                candidate.Status == "running" &&
                candidate.ParticipantProfileIds.Contains(profileId, StringComparer.OrdinalIgnoreCase));
            if (conversation is not null)
            {
                return new ManagedConversationOutput(conversation, IsSupervisor: false, item.TaskId);
            }
        }

        return null;
    }

    private async Task<bool> HasMatchingDelegatedTaskAsync(
        string workspacePath,
        string conversationId,
        string profileId,
        string taskId,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        var events = await timelineStore.ListAsync(workspacePath, cancellationToken)
            .ConfigureAwait(false);
        return events.Any(item =>
            item.Kind == CollaborationEventKind.UserMessage &&
            string.Equals(item.ProfileId, "agenthub", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(item.TargetProfileId, profileId, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(item.ConversationId, conversationId, StringComparison.Ordinal) &&
            string.Equals(item.TaskId, taskId, StringComparison.Ordinal) &&
            SessionMatches(item.SessionId, sessionId));
    }

    private async Task<AgentConversation> RouteManagerSendCommandAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHubSendMessageCommand command,
        CancellationToken cancellationToken)
    {
        var targetSession = sessionRegistry.FindLatest(workspacePath, command.To);
        if (targetSession is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"No active session for profile '{command.To}' in workspace '{workspacePath}'.",
                conversation.Id,
                command.TaskId,
                command.TeamId,
                command.PlanId,
                cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            targetSession.Id,
            BuildDelegatedTaskPrompt(conversation, command),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(targetSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"Unable to send manager conversation task to session '{targetSession.Id}': {sendResult.Status}",
                conversation.Id,
                command.TaskId,
                command.TeamId,
                command.PlanId,
                cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var updated = await RecordDeliveryStepAsync(
            workspacePath,
            conversation,
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                command.To,
                command.Message,
                conversation.Id,
                command.TaskId,
                command.TeamId,
                command.PlanId,
                targetSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task<AgentConversation> RouteParticipantObservationAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        string? taskId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(conversation.SupervisorProfileId))
        {
            return conversation;
        }

        var supervisorSession = sessionRegistry.FindLatest(workspacePath, conversation.SupervisorProfileId);
        if (supervisorSession is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"No active session for profile '{conversation.SupervisorProfileId}' in workspace '{workspacePath}'.",
                conversation.Id,
                taskId,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                workspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            supervisorSession.Id,
            BuildObservationPrompt(conversation, hookEvent, taskId),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(supervisorSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"Unable to send manager conversation observation to session '{supervisorSession.Id}': {sendResult.Status}",
                conversation.Id,
                taskId,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var updated = await RecordDeliveryStepAsync(workspacePath, conversation, cancellationToken)
            .ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                conversation.SupervisorProfileId,
                hookEvent.Message,
                conversation.Id,
                taskId,
                SessionId: supervisorSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task<AgentConversation> RouteRoundtableOutputAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken)
    {
        if (conversation.MaxSteps is not null && conversation.CurrentStep >= conversation.MaxSteps)
        {
            var completed = await conversationStore.UpdateAsync(
                workspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "completed"),
                cancellationToken).ConfigureAwait(false);
            await timelineStore.AppendUserMessageAsync(
                new CollaborationUserMessage(
                    workspacePath,
                    "agenthub",
                    "workflow",
                    $"[roundtable_completed] {hookEvent.Message}",
                    ConversationId: conversation.Id),
                cancellationToken).ConfigureAwait(false);
            return completed;
        }

        var nextStep = conversation.CurrentStep + 1;
        var nextProfileId = RoundtableSpeakerForStep(conversation, nextStep);
        var nextSession = sessionRegistry.FindLatest(workspacePath, nextProfileId);
        if (nextSession is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"No active session for profile '{nextProfileId}' in workspace '{workspacePath}'.",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                workspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            nextSession.Id,
            BuildRoundtableTurnPrompt(conversation, hookEvent, nextStep),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(nextSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"Unable to send roundtable conversation prompt to session '{nextSession.Id}': {sendResult.Status}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: nextStep),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                nextProfileId,
                hookEvent.Message,
                ConversationId: conversation.Id,
                SessionId: nextSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task<AgentConversation> RoutePairNegotiationOutputAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken)
    {
        var parsed = AgentHubCommandParser.Parse(hookEvent.Message);
        foreach (var error in parsed.Errors)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"[parse_error {error.Code} #{error.Index}] {error.Message}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
        }

        var command = parsed.PairNegotiationCommands
            .FirstOrDefault(candidate => candidate.Action is "continue" or "accept");
        if (command is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                "Pair negotiation output did not contain a continue or accept command.",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        if (command.Action == "accept")
        {
            return await AcceptPairNegotiationProposalAsync(
                workspacePath,
                conversation,
                hookEvent,
                command,
                cancellationToken).ConfigureAwait(false);
        }

        return await ContinuePairNegotiationAsync(
            workspacePath,
            conversation,
            hookEvent,
            command,
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<AgentConversation> ContinuePairNegotiationAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        AgentHubPairNegotiationCommand command,
        CancellationToken cancellationToken)
    {
        if (conversation.MaxSteps is not null && conversation.CurrentStep >= conversation.MaxSteps)
        {
            return await PausePairNegotiationAtLimitAsync(workspacePath, conversation, cancellationToken)
                .ConfigureAwait(false);
        }

        var targetProfileId = OtherPairNegotiationParticipant(conversation, hookEvent.ProfileId ?? "");
        if (targetProfileId is null)
        {
            return conversation;
        }

        var targetSession = sessionRegistry.FindLatest(workspacePath, targetProfileId);
        if (targetSession is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"No active session for profile '{targetProfileId}' in workspace '{workspacePath}'.",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                workspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            targetSession.Id,
            BuildPairNegotiationTurnPrompt(conversation, hookEvent, command, targetProfileId),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(targetSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"Unable to send pair negotiation prompt to session '{targetSession.Id}': {sendResult.Status}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: conversation.CurrentStep + 1),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                targetProfileId,
                FormatPairNegotiationCommand(command),
                ConversationId: conversation.Id,
                SessionId: targetSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task<AgentConversation> AcceptPairNegotiationProposalAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        AgentHubPairNegotiationCommand command,
        CancellationToken cancellationToken)
    {
        var profileId = hookEvent.ProfileId ?? "agent";
        var version = FormatProposalVersion(command.ProposalVersion);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                profileId,
                "pair-negotiation",
                $"[accept v{version}] {command.Summary}",
                ConversationId: conversation.Id),
            cancellationToken).ConfigureAwait(false);

        var acceptedProfiles = await AcceptedPairNegotiationProfilesAsync(
            workspacePath,
            conversation.Id,
            command.ProposalVersion,
            cancellationToken).ConfigureAwait(false);
        if (conversation.ParticipantProfileIds.All(profile =>
                acceptedProfiles.Contains(profile, StringComparer.OrdinalIgnoreCase)))
        {
            var completed = await conversationStore.UpdateAsync(
                workspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "completed"),
                cancellationToken).ConfigureAwait(false);
            await timelineStore.AppendUserMessageAsync(
                new CollaborationUserMessage(
                    workspacePath,
                    "agenthub",
                    "workflow",
                    $"[pair_negotiation_completed v{version}] {command.Summary}",
                    ConversationId: conversation.Id),
                cancellationToken).ConfigureAwait(false);
            return completed;
        }

        if (conversation.MaxSteps is not null && conversation.CurrentStep >= conversation.MaxSteps)
        {
            return await PausePairNegotiationAtLimitAsync(workspacePath, conversation, cancellationToken)
                .ConfigureAwait(false);
        }

        var targetProfileId = OtherPairNegotiationParticipant(conversation, profileId);
        if (targetProfileId is null)
        {
            return conversation;
        }

        var targetSession = sessionRegistry.FindLatest(workspacePath, targetProfileId);
        if (targetSession is null)
        {
            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"No active session for profile '{targetProfileId}' in workspace '{workspacePath}'.",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return await conversationStore.UpdateAsync(
                workspacePath,
                conversation.Id,
                new UpdateAgentConversationRequest(Status: "failed"),
                cancellationToken).ConfigureAwait(false);
        }

        var sendResult = await inputRouter.TrySendLineDetailedAsync(
            targetSession.Id,
            BuildPairNegotiationAcceptancePrompt(conversation, hookEvent, command, targetProfileId),
            cancellationToken).ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(targetSession.Id);
            }

            await timelineStore.AppendCommandErrorAsync(
                workspacePath,
                $"Unable to send pair negotiation prompt to session '{targetSession.Id}': {sendResult.Status}",
                conversation.Id,
                cancellationToken: cancellationToken).ConfigureAwait(false);
            return conversation;
        }

        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(CurrentStep: conversation.CurrentStep + 1),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                targetProfileId,
                $"[accept v{version}] {command.Summary}",
                ConversationId: conversation.Id,
                SessionId: targetSession.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task<AgentConversation> ApplyManagerWorkflowCommandAsync(
        string workspacePath,
        AgentConversation conversation,
        AgentHubWorkflowCommand command,
        CancellationToken cancellationToken)
    {
        var nextStatus = command.Action switch
        {
            "ask_user" => "paused",
            "done" => "completed",
            _ => conversation.Status
        };
        if (nextStatus == conversation.Status && command.Action is not ("ask_user" or "done"))
        {
            return conversation;
        }

        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(Status: nextStatus),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                "workflow",
                FormatWorkflowCommand(command),
                conversation.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private static string BuildInitialManagerPrompt(AgentConversation conversation)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub manager conversation.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Participants: {string.Join(", ", conversation.ParticipantProfileIds)}",
                "Delegate work with exactly this command format when another agent should act:",
                "<agenthub>{\"action\":\"send\",\"target\":\"codex\",\"task_id\":\"T-001\",\"message\":\"Task details\"}</agenthub>",
                "Wait for observations before sending the next task."
            ]);
    }

    private static string BuildInitialRoundtablePrompt(AgentConversation conversation)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub roundtable conversation.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Participants: {string.Join(" -> ", conversation.ParticipantProfileIds)}",
                "You are the first speaker. Give a concise view, then stop and wait."
            ]);
    }

    private static string BuildInitialPairNegotiationPrompt(AgentConversation conversation)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub pair negotiation conversation.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Participants: {string.Join(" <-> ", conversation.ParticipantProfileIds)}",
                "Proposal version: 1",
                "Give a concise proposal, then use one command:",
                "<agenthub>{\"action\":\"continue\",\"proposal_version\":1,\"summary\":\"Short summary\",\"message\":\"Request review from the other participant\"}</agenthub>",
                "<agenthub>{\"action\":\"accept\",\"proposal_version\":1,\"summary\":\"Accepted\"}</agenthub>"
            ]);
    }

    private static string BuildDelegatedTaskPrompt(
        AgentConversation conversation,
        AgentHubSendMessageCommand command)
    {
        var lines = new List<string>
        {
            "AgentHub delegated task.",
            $"Conversation: {conversation.Id}"
        };
        if (!string.IsNullOrWhiteSpace(command.PlanId))
        {
            lines.Add($"Plan: {command.PlanId}");
        }

        if (!string.IsNullOrWhiteSpace(command.TaskId))
        {
            lines.Add($"Task: {command.TaskId}");
        }

        lines.Add("");
        lines.Add(command.Message);
        lines.Add("");
        lines.Add("When finished, rely on the configured AgentHub hook to return your final result. Keep the result focused on this task.");
        return string.Join("\r\n", lines);
    }

    private static string BuildObservationPrompt(
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        string? taskId)
    {
        return string.Join(
            "\r\n",
            [
                $"Observation from {hookEvent.ProfileId ?? "agent"}.",
                $"Conversation: {conversation.Id}",
                $"Task: {taskId ?? "unknown"}",
                "",
                hookEvent.Message,
                "",
                "Continue the manager conversation with the next bounded step, ask the user, or finish with a done command."
            ]);
    }

    private static string BuildRoundtableTurnPrompt(
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        int nextStep)
    {
        var isSummaryTurn = conversation.MaxSteps is not null && nextStep >= conversation.MaxSteps;
        return string.Join(
            "\r\n",
            [
                "AgentHub roundtable conversation.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Previous speaker: {hookEvent.ProfileId ?? "agent"}",
                "",
                hookEvent.Message,
                "",
                isSummaryTurn
                    ? "Please provide the final summary, including consensus, disagreements, and next actions."
                    : "Please respond with your bounded view, then stop and wait."
            ]);
    }

    private static string BuildPairNegotiationTurnPrompt(
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        AgentHubPairNegotiationCommand command,
        string targetProfileId)
    {
        var version = FormatProposalVersion(command.ProposalVersion);
        return string.Join(
            "\r\n",
            [
                "AgentHub pair negotiation conversation.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Previous speaker: {hookEvent.ProfileId ?? "agent"}",
                $"Next speaker: {targetProfileId}",
                $"Proposal version: {version}",
                string.IsNullOrWhiteSpace(command.Summary) ? "" : $"Summary: {command.Summary}",
                string.IsNullOrWhiteSpace(command.ArtifactPath) ? "" : $"Artifact: {command.ArtifactPath}",
                "",
                command.Message ?? hookEvent.Message,
                "",
                "Respond with continue for a revision or accept when the proposal is good enough."
            ]);
    }

    private static string BuildPairNegotiationAcceptancePrompt(
        AgentConversation conversation,
        AgentHookEvent hookEvent,
        AgentHubPairNegotiationCommand command,
        string targetProfileId)
    {
        var version = FormatProposalVersion(command.ProposalVersion);
        return string.Join(
            "\r\n",
            [
                "AgentHub pair negotiation acceptance.",
                $"Conversation: {conversation.Id}",
                $"Topic: {conversation.Topic}",
                $"Accepted by: {hookEvent.ProfileId ?? "agent"}",
                $"Next speaker: {targetProfileId}",
                $"Proposal version: {version}",
                "",
                command.Summary ?? "Accepted",
                "",
                "Accept the same proposal version to complete the negotiation, or continue with a revision."
            ]);
    }

    private static string FormatWorkflowCommand(AgentHubWorkflowCommand command)
    {
        var message = string.IsNullOrWhiteSpace(command.Message) ? "completed" : command.Message;
        return $"[{command.Action}] {message}";
    }

    private async Task<AgentConversation> RecordDeliveryStepAsync(
        string workspacePath,
        AgentConversation conversation,
        CancellationToken cancellationToken)
    {
        var nextStep = conversation.CurrentStep + 1;
        var nextStatus = conversation.MaxSteps is not null && nextStep >= conversation.MaxSteps
            ? "paused"
            : conversation.Status;
        return await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(Status: nextStatus, CurrentStep: nextStep),
            cancellationToken).ConfigureAwait(false);
    }

    private static bool SessionMatches(string? expectedSessionId, string? actualSessionId)
    {
        return string.IsNullOrWhiteSpace(expectedSessionId) ||
               string.IsNullOrWhiteSpace(actualSessionId) ||
               string.Equals(expectedSessionId, actualSessionId, StringComparison.OrdinalIgnoreCase);
    }

    private static IReadOnlyList<string> NormalizeRoundtableParticipants(IReadOnlyList<string> participantProfileIds)
    {
        return participantProfileIds
            .Where(profileId => !string.IsNullOrWhiteSpace(profileId))
            .Select(profileId => profileId.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(profileId =>
            {
                var index = Array.FindIndex(
                    RoundtableProfileOrder,
                    candidate => string.Equals(candidate, profileId, StringComparison.OrdinalIgnoreCase));
                return index < 0 ? int.MaxValue : index;
            })
            .ThenBy(profileId => Array.FindIndex(
                participantProfileIds.ToArray(),
                candidate => string.Equals(candidate, profileId, StringComparison.OrdinalIgnoreCase)))
            .ToArray();
    }

    private static IReadOnlyList<string> NormalizePairNegotiationParticipants(IReadOnlyList<string> participantProfileIds)
    {
        var participants = participantProfileIds
            .Where(profileId => !string.IsNullOrWhiteSpace(profileId))
            .Select(profileId => profileId.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (participants.Length != 2)
        {
            throw new InvalidOperationException("Pair negotiation requires exactly two participants.");
        }

        return participants;
    }

    private static string RoundtableSpeakerForStep(AgentConversation conversation, int step)
    {
        var index = Math.Max(0, step - 1) % conversation.ParticipantProfileIds.Count;
        return conversation.ParticipantProfileIds[index];
    }

    private static string PairNegotiationSpeakerForStep(AgentConversation conversation, int step)
    {
        var index = Math.Max(0, step - 1) % conversation.ParticipantProfileIds.Count;
        return conversation.ParticipantProfileIds[index];
    }

    private static string? OtherPairNegotiationParticipant(AgentConversation conversation, string profileId)
    {
        return conversation.ParticipantProfileIds.FirstOrDefault(
            participant => !string.Equals(participant, profileId, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<IReadOnlySet<string>> AcceptedPairNegotiationProfilesAsync(
        string workspacePath,
        string conversationId,
        double proposalVersion,
        CancellationToken cancellationToken)
    {
        var version = FormatProposalVersion(proposalVersion);
        var acceptedProfiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in await timelineStore.ListAsync(workspacePath, cancellationToken).ConfigureAwait(false))
        {
            if (item.Kind == CollaborationEventKind.UserMessage &&
                string.Equals(item.ConversationId, conversationId, StringComparison.Ordinal) &&
                string.Equals(item.TargetProfileId, "pair-negotiation", StringComparison.OrdinalIgnoreCase) &&
                item.Message.StartsWith($"[accept v{version}]", StringComparison.Ordinal) &&
                !string.IsNullOrWhiteSpace(item.ProfileId))
            {
                acceptedProfiles.Add(item.ProfileId);
            }
        }

        return acceptedProfiles;
    }

    private async Task<AgentConversation> PausePairNegotiationAtLimitAsync(
        string workspacePath,
        AgentConversation conversation,
        CancellationToken cancellationToken)
    {
        var updated = await conversationStore.UpdateAsync(
            workspacePath,
            conversation.Id,
            new UpdateAgentConversationRequest(Status: "paused"),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                "workflow",
                "[pair_negotiation_paused] Max steps reached.",
                ConversationId: conversation.Id),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private static string FormatPairNegotiationCommand(AgentHubPairNegotiationCommand command)
    {
        var version = FormatProposalVersion(command.ProposalVersion);
        var message = command.Action == "continue"
            ? command.Summary ?? command.Message ?? command.ArtifactPath ?? "updated"
            : command.Summary ?? command.ArtifactPath ?? "accepted";
        return $"[{command.Action} v{version}] {message}";
    }

    private static string FormatProposalVersion(double proposalVersion)
    {
        return proposalVersion.ToString("0.##", CultureInfo.InvariantCulture);
    }

    private sealed record ManagedConversationOutput(
        AgentConversation Conversation,
        bool IsSupervisor,
        string? TaskId);
}
