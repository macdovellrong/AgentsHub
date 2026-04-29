import { describe, expect, it } from "vitest";
import { hideDefaultApplicationMenu } from "./application-menu";

describe("hideDefaultApplicationMenu", () => {
  it("removes Electron's default application menu", () => {
    const calls: unknown[] = [];

    hideDefaultApplicationMenu((menu) => calls.push(menu));

    expect(calls).toEqual([null]);
  });
});
