namespace AgentHub.Native.Core.Workspaces;

public sealed record WorkspaceEntry(string Path, string Name)
{
    public override string ToString()
    {
        return $"{Name}  {Path}";
    }
}
