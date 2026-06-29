namespace AgentHub.Native.Core.TaskPlans;

public sealed record AgentTaskPlanSource(
    string DirectoryName,
    string Title,
    string TaskDir,
    string SourcePlanPath);
