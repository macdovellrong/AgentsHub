import { describe, expect, it } from "vitest";
import { buildAgentHostLaunchPlan } from "./agent-host-launcher";

describe("buildAgentHostLaunchPlan", () => {
  it("keeps user command metadata while spawning PowerShell for managed agents", () => {
    const plan = buildAgentHostLaunchPlan({
      profile: {
        id: "codex",
        name: "Codex",
        kind: "codex",
        command: "codex.cmd",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        launchMode: "powershell",
        useWorkspaceWriteLock: true,
      },
      launchArgs: ["--no-alt-screen", "resume", "--last"],
      cwd: "V:/AgentGroup",
      env: { PATH: "C:/bin" },
    });

    expect(plan.metadata.command).toBe("codex.cmd");
    expect(plan.metadata.args).toEqual(["--no-alt-screen", "resume", "--last"]);
    expect(plan.spawn.command.toLowerCase()).toContain("powershell");
    expect(plan.spawn.args).toContain("-NoExit");
    expect(plan.spawn.args.join(" ")).toContain("Set-Location -LiteralPath");
    expect(plan.spawn.args.join(" ")).toContain("codex.cmd");
    expect(plan.host.kind).toBe("powershell");
  });

  it("can spawn cmd as the host while preserving the same metadata", () => {
    const plan = buildAgentHostLaunchPlan({
      profile: {
        id: "gemini",
        name: "Gemini",
        kind: "gemini",
        command: "gemini.cmd",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        launchMode: "cmd",
        useWorkspaceWriteLock: false,
      },
      launchArgs: ["--resume", "latest"],
      cwd: "V:/Agent Hub",
      env: { PATH: "C:/bin" },
    });

    expect(plan.metadata).toEqual({ command: "gemini.cmd", args: ["--resume", "latest"] });
    expect(plan.spawn.command.toLowerCase()).toContain("cmd");
    expect(plan.spawn.args[0]).toBe("/K");
    expect(plan.spawn.args[1]).toContain('cd /d "V:/Agent Hub"');
    expect(plan.spawn.args[1]).toContain('"gemini.cmd" "--resume" "latest"');
    expect(plan.host.kind).toBe("cmd");
  });

  it("spawns the agent command directly in direct mode", () => {
    const plan = buildAgentHostLaunchPlan({
      profile: {
        id: "custom",
        name: "Custom",
        kind: "custom",
        command: "tool.exe",
        args: [],
        aliases: [],
        rolePrompt: "",
        env: {},
        defaultCwd: null,
        launchMode: "direct",
        useWorkspaceWriteLock: false,
      },
      launchArgs: ["run"],
      cwd: "V:/AgentGroup",
      env: { PATH: "C:/bin" },
    });

    expect(plan.spawn).toEqual({ command: "tool.exe", args: ["run"] });
    expect(plan.host.kind).toBe("direct");
  });
});
