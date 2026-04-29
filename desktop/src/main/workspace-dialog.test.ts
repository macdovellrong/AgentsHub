import { describe, expect, it } from "vitest";
import { selectWorkspacePath } from "./workspace-dialog";

describe("selectWorkspacePath", () => {
  it("returns the chosen directory when the user selects one", async () => {
    await expect(
      selectWorkspacePath("C:/current", async () => ({
        canceled: false,
        filePaths: ["D:/project"],
      })),
    ).resolves.toBe("D:/project");
  });

  it("keeps the current workspace when the dialog is canceled", async () => {
    await expect(
      selectWorkspacePath("C:/current", async () => ({
        canceled: true,
        filePaths: [],
      })),
    ).resolves.toBe("C:/current");
  });
});
