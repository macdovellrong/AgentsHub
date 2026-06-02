import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installProjectAgentHooks } from "./project-hook-installer";

let workspacePath: string | undefined;
let sourceHooksPath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
  if (sourceHooksPath) {
    await rm(sourceHooksPath, { recursive: true, force: true });
    sourceHooksPath = undefined;
  }
});

async function createHookSource(): Promise<string> {
  sourceHooksPath = await mkdtemp(path.join(tmpdir(), "agenthub-hook-src-"));
  await Promise.all([
    writeFile(path.join(sourceHooksPath, "agenthub_hook_common.py"), "# common\n", "utf8"),
    writeFile(path.join(sourceHooksPath, "agenthub_codex_stop.py"), "# codex\n", "utf8"),
    writeFile(path.join(sourceHooksPath, "agenthub_claude_stop.py"), "# claude\n", "utf8"),
    writeFile(path.join(sourceHooksPath, "agenthub_gemini_after_agent.py"), "# gemini\n", "utf8"),
  ]);
  return sourceHooksPath;
}

describe("installProjectAgentHooks", () => {
  it("creates project-scoped hook scripts and merges all CLI configs without dropping existing settings", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-project-hooks-"));
    const sourceHooksDir = await createHookSource();
    await mkdir(path.join(workspacePath, ".codex"), { recursive: true });
    await mkdir(path.join(workspacePath, ".claude"), { recursive: true });
    await mkdir(path.join(workspacePath, ".gemini"), { recursive: true });
    await writeFile(path.join(workspacePath, ".codex", "config.toml"), "[features]\nother_feature = true\n", "utf8");
    await writeFile(
      path.join(workspacePath, ".codex", "hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo existing-codex" }] }] } }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(workspacePath, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(workspacePath, ".gemini", "settings.json"),
      JSON.stringify({ theme: "dark", hooks: { AfterAgent: [{ matcher: "ShellTool", hooks: [{ command: "echo existing-gemini" }] }] } }, null, 2),
      "utf8",
    );

    await installProjectAgentHooks(workspacePath, { sourceHooksDir });
    await installProjectAgentHooks(workspacePath, { sourceHooksDir });

    await expect(readFile(path.join(workspacePath, ".codex", "hooks", "agenthub_hook_common.py"), "utf8")).resolves.toBe(
      "# common\n",
    );
    await expect(readFile(path.join(workspacePath, ".claude", "hooks", "agenthub_claude_stop.py"), "utf8")).resolves.toBe(
      "# claude\n",
    );
    await expect(
      readFile(path.join(workspacePath, ".gemini", "hooks", "agenthub_gemini_after_agent.py"), "utf8"),
    ).resolves.toBe("# gemini\n");

    const codexConfig = await readFile(path.join(workspacePath, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("other_feature = true");
    expect(codexConfig).toContain("hooks = true");
    expect(codexConfig).not.toContain("codex_hooks");

    const codexHooks = JSON.parse(await readFile(path.join(workspacePath, ".codex", "hooks.json"), "utf8"));
    expect(codexHooks.hooks.Stop).toHaveLength(2);
    expect(JSON.stringify(codexHooks)).toContain("existing-codex");
    expect(JSON.stringify(codexHooks)).toContain("agenthub_codex_stop.py");
    expect(JSON.stringify(codexHooks).match(/agenthub_codex_stop\.py/g)).toHaveLength(1);

    const claudeSettings = JSON.parse(await readFile(path.join(workspacePath, ".claude", "settings.local.json"), "utf8"));
    expect(claudeSettings.permissions.allow).toEqual(["Bash(npm test)"]);
    expect(JSON.stringify(claudeSettings.hooks.Stop)).toContain("agenthub_claude_stop.py");
    expect(JSON.stringify(claudeSettings.hooks.StopFailure)).toContain("agenthub_claude_stop.py");
    expect(JSON.stringify(claudeSettings).match(/agenthub_claude_stop\.py/g)).toHaveLength(2);

    const geminiSettings = JSON.parse(await readFile(path.join(workspacePath, ".gemini", "settings.json"), "utf8"));
    expect(geminiSettings.theme).toBe("dark");
    expect(JSON.stringify(geminiSettings)).toContain("existing-gemini");
    expect(JSON.stringify(geminiSettings.hooks.AfterAgent)).toContain("agenthub_gemini_after_agent.py");
    expect(JSON.stringify(geminiSettings).match(/agenthub_gemini_after_agent\.py/g)).toHaveLength(1);
  });

  it("removes deprecated Codex hook feature flags from existing project configs", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-project-hooks-"));
    const sourceHooksDir = await createHookSource();
    await mkdir(path.join(workspacePath, ".codex"), { recursive: true });
    await writeFile(
      path.join(workspacePath, ".codex", "config.toml"),
      "[features]\ncodex_hooks = true\nother_feature = true\n",
      "utf8",
    );

    await installProjectAgentHooks(workspacePath, { sourceHooksDir });

    const codexConfig = await readFile(path.join(workspacePath, ".codex", "config.toml"), "utf8");
    expect(codexConfig).toContain("hooks = true");
    expect(codexConfig).toContain("other_feature = true");
    expect(codexConfig).not.toContain("codex_hooks");
  });
});
