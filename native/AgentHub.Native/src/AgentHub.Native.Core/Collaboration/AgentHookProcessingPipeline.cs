using AgentHub.Native.Core.Hooks;
using AgentHub.Native.Core.TaskPlans;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentHookProcessingPipeline(
    CollaborationEventStore eventStore,
    AgentHookEventProcessor generalProcessor,
    AgentTaskPlanService taskPlanService,
    AgentConversationOrchestrator conversationOrchestrator)
{
    public async Task<AgentHubCommandDispatchResult> ProcessAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        if (await conversationOrchestrator.CanHandleAgentOutputAsync(hookEvent, cancellationToken)
                .ConfigureAwait(false))
        {
            var sourceEvent = await eventStore.AppendAgentOutputAsync(hookEvent, cancellationToken)
                .ConfigureAwait(false);
            await conversationOrchestrator.HandleAgentOutputAsync(hookEvent, cancellationToken)
                .ConfigureAwait(false);
            return EmptyDispatchResult(sourceEvent.Id);
        }

        var result = await generalProcessor.ProcessAsync(hookEvent, cancellationToken).ConfigureAwait(false);
        await taskPlanService.RecordManagerDispatchResultAsync(
            hookEvent.Workspace,
            hookEvent.ProfileId ?? hookEvent.Source ?? "agent",
            result,
            result.SourceEventId,
            cancellationToken).ConfigureAwait(false);
        await taskPlanService.RecordHookCompletionAsync(
            hookEvent.Workspace,
            new AgentTaskPlanHookCompletionInput(
                hookEvent.ProfileId ?? hookEvent.Source ?? "agent",
                hookEvent.Message,
                hookEvent.SessionId,
                hookEvent.RunId,
                hookEvent.PlanId,
                hookEvent.TaskId,
                SourceEventId: result.SourceEventId),
            cancellationToken).ConfigureAwait(false);
        return result;
    }

    private static AgentHubCommandDispatchResult EmptyDispatchResult(string sourceEventId)
    {
        return new AgentHubCommandDispatchResult(0, [], [], [], [], [], [], [])
        {
            SourceEventId = sourceEventId
        };
    }
}
