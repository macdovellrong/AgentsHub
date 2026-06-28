using AgentHub.Native.Core.Hooks;

namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentHookEventProcessor(
    CollaborationEventStore eventStore,
    AgentHubCommandDispatcher commandDispatcher)
{
    public async Task<AgentHubCommandDispatchResult> ProcessAsync(
        AgentHookEvent hookEvent,
        CancellationToken cancellationToken = default)
    {
        await eventStore.AppendAgentOutputAsync(hookEvent, cancellationToken).ConfigureAwait(false);
        var dispatchResult = await commandDispatcher.DispatchAsync(
            hookEvent.Workspace,
            hookEvent.Message,
            cancellationToken).ConfigureAwait(false);
        await eventStore.AppendForwardedAgentHubCommandsAsync(
            hookEvent.Workspace,
            dispatchResult,
            cancellationToken).ConfigureAwait(false);
        return dispatchResult;
    }
}
