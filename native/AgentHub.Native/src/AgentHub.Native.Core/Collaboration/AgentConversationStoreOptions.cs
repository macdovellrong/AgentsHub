namespace AgentHub.Native.Core.Collaboration;

public sealed class AgentConversationStoreOptions
{
    public Func<DateTimeOffset> UtcNow { get; init; } = () => DateTimeOffset.UtcNow;
}
