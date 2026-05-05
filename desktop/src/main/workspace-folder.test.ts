import { describe, expect, it } from "vitest";
import { openWorkspaceFolderPath } from "./workspace-folder";

describe("openWorkspaceFolderPath", () => {
  it("opens the requested workspace path", async () => {
    const openedPaths: string[] = [];

    await openWorkspaceFolderPath("V:/AgentGroup", async (workspacePath) => {
      openedPaths.push(workspacePath);
      return "";
    });

    expect(openedPaths).toEqual(["V:/AgentGroup"]);
  });

  it("surfaces shell open errors", async () => {
    await expect(openWorkspaceFolderPath("V:/missing", async () => "The system cannot find the path specified.")).rejects.toThrow(
      "The system cannot find the path specified.",
    );
  });
});
