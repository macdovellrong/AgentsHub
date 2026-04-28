import { describe, expect, it } from "vitest";
import { getAllowedDevRendererUrl } from "./renderer-url";

describe("getAllowedDevRendererUrl", () => {
  it("allows localhost renderer URLs in development", () => {
    expect(getAllowedDevRendererUrl("http://localhost:5173", { isPackaged: false, nodeEnv: "development" })).toBe(
      "http://localhost:5173/",
    );
    expect(getAllowedDevRendererUrl("http://127.0.0.1:5173", { isPackaged: false, nodeEnv: "development" })).toBe(
      "http://127.0.0.1:5173/",
    );
    expect(getAllowedDevRendererUrl("http://[::1]:5173", { isPackaged: false, nodeEnv: "development" })).toBe(
      "http://[::1]:5173/",
    );
  });

  it("rejects remote renderer URLs", () => {
    expect(getAllowedDevRendererUrl("https://example.com/app", { isPackaged: false, nodeEnv: "development" })).toBeNull();
  });

  it("rejects renderer URLs in production", () => {
    expect(getAllowedDevRendererUrl("http://localhost:5173", { isPackaged: false })).toBeNull();
    expect(getAllowedDevRendererUrl("http://localhost:5173", { isPackaged: false, nodeEnv: "production" })).toBeNull();
    expect(getAllowedDevRendererUrl("http://localhost:5173", { isPackaged: true, nodeEnv: "development" })).toBeNull();
  });
});
