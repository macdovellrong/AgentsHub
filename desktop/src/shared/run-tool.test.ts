import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("run-tool", () => {
  const uncCwd = (
    process.env.RUN_TOOL_TEST_CWD ??
    process.env.INIT_CWD ??
    process.cwd()
  ).replace(/^Microsoft\.PowerShell\.Core\\FileSystem::/, "");

  it.each([
    ['has"quote'],
    ["%PATH%"],
    ["has!PATH!"],
    ["has^caret"],
  ])("preserves %s in arguments on UNC paths", (value) => {
    const cwd = uncCwd;
    if (!cwd.startsWith("\\\\")) {
      return;
    }

    const result = spawnSync(
      process.execPath,
      [
        "./scripts/run-tool.cjs",
        "-e",
        "console.log(process.argv[1])",
        value,
      ],
      {
        cwd,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(value);
  });
});
