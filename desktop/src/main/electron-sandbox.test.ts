import { describe, expect, it } from "vitest";
import { shouldDisableElectronSandbox } from "./electron-sandbox";

describe("shouldDisableElectronSandbox", () => {
  it("disables sandbox for development source runs", () => {
    expect(shouldDisableElectronSandbox({ isPackaged: false, nodeEnv: "development" })).toBe(true);
  });

  it("allows an explicit sandbox disable override", () => {
    expect(shouldDisableElectronSandbox({ isPackaged: false, noSandbox: "1" })).toBe(true);
  });

  it("keeps sandbox enabled for packaged and production runs by default", () => {
    expect(shouldDisableElectronSandbox({ isPackaged: true, nodeEnv: "development" })).toBe(false);
    expect(shouldDisableElectronSandbox({ isPackaged: false, nodeEnv: "production" })).toBe(false);
    expect(shouldDisableElectronSandbox({ isPackaged: false })).toBe(false);
  });
});
