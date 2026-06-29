namespace AgentHub.Native.Core.TaskPlans;

public sealed class AgentTaskPlanStoreOptions
{
    public Func<DateTimeOffset>? UtcNow { get; init; }
}
