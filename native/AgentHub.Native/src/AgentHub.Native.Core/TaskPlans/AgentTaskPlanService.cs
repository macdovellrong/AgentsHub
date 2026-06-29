using AgentHub.Native.Core.Collaboration;
using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.TaskPlans;

public sealed class AgentTaskPlanService(
    AgentTaskPlanStore store,
    CollaborationEventStore timelineStore,
    AgentInputRouter inputRouter,
    AgentSessionRegistry sessionRegistry)
{
    public async Task<AgentTaskPlan> CreatePlanAsync(
        string workspacePath,
        CreateAgentTaskPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        var plan = await store.CreatePlanAsync(workspacePath, request, cancellationToken).ConfigureAwait(false);
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "created",
                Message: plan.Title,
                ToProfileId: plan.ManagerProfileId),
            cancellationToken).ConfigureAwait(false);
        return plan;
    }

    public async Task<AgentTaskPlan> StartManagerAsync(
        string workspacePath,
        string planId,
        CancellationToken cancellationToken = default)
    {
        var plan = await store.GetPlanAsync(workspacePath, planId, cancellationToken).ConfigureAwait(false);
        var managerSession = sessionRegistry.FindLatest(workspacePath, plan.ManagerProfileId);
        if (managerSession is null)
        {
            await RecordDeliveryFailureAsync(
                workspacePath,
                plan,
                plan.ManagerProfileId,
                $"No active session for profile '{plan.ManagerProfileId}'",
                cancellationToken).ConfigureAwait(false);
            return plan;
        }

        var prompt = BuildManagerPrompt(plan);
        var sendResult = await inputRouter.TrySendLineDetailedAsync(managerSession.Id, prompt, cancellationToken)
            .ConfigureAwait(false);
        if (!sendResult.Sent)
        {
            if (sendResult.ShouldRemoveSession)
            {
                sessionRegistry.Remove(managerSession.Id);
            }

            await RecordDeliveryFailureAsync(
                workspacePath,
                plan,
                plan.ManagerProfileId,
                $"Unable to send task-plan manager prompt to session '{managerSession.Id}': {sendResult.Status}",
                cancellationToken).ConfigureAwait(false);
            return plan;
        }

        var updated = await store.UpdatePlanStatusAsync(workspacePath, plan.Id, "running", cancellationToken)
            .ConfigureAwait(false);
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "manager_started",
                ToProfileId: plan.ManagerProfileId,
                Message: "Manager started",
                SessionId: managerSession.Id),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendUserMessageAsync(
            new CollaborationUserMessage(
                workspacePath,
                "agenthub",
                plan.ManagerProfileId,
                $"Task plan manager started: {plan.Title}"),
            cancellationToken).ConfigureAwait(false);
        return updated;
    }

    private async Task RecordDeliveryFailureAsync(
        string workspacePath,
        AgentTaskPlan plan,
        string targetProfileId,
        string message,
        CancellationToken cancellationToken)
    {
        await store.AppendEventAsync(
            workspacePath,
            plan.Id,
            new AgentTaskPlanLogEventInput(
                "delivery_failed",
                ToProfileId: targetProfileId,
                Message: message),
            cancellationToken).ConfigureAwait(false);
        await timelineStore.AppendCommandErrorAsync(workspacePath, message, cancellationToken)
            .ConfigureAwait(false);
    }

    private static string BuildManagerPrompt(AgentTaskPlan plan)
    {
        return string.Join(
            "\r\n",
            [
                "AgentHub task-plan manager.",
                $"Plan ID: {plan.Id}",
                $"Task source task-plan.md: {plan.SourcePlanPath}",
                $"Execution snapshot: {Path.Combine(plan.PlanPath, "task-plan.md")}",
                $"Available agents: {string.Join(", ", plan.ParticipantProfileIds)}",
                "",
                "Use the execution snapshot as the plan for this run. Manage one bounded step at a time. Do not paste long chat history into agent prompts.",
                "Delegate with this exact command shape:",
                "<agenthub>{\"action\":\"assign_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"Implement the bounded task\"}</agenthub>",
                "Request review with:",
                "<agenthub>{\"action\":\"request_review\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"to\":\"gemini\",\"message\":\"Review the artifact and risks\"}</agenthub>",
                "Approve with:",
                "<agenthub>{\"action\":\"approve_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"summary\":\"Accepted\"}</agenthub>",
                "Reject with:",
                "<agenthub>{\"action\":\"reject_task\",\"plan_id\":\"" + plan.Id + "\",\"task_id\":\"T001\",\"to\":\"codex\",\"message\":\"Required fixes\"}</agenthub>",
                "Pause with:",
                "<agenthub>{\"action\":\"pause_plan\",\"plan_id\":\"" + plan.Id + "\",\"reason\":\"Need user decision\"}</agenthub>",
                "Wait for hook observations before assigning the next step."
            ]);
    }
}
