import { describe, expect, it } from "vitest";
import { createDevServerWatchOptions } from "./dev-watch";

describe("createDevServerWatchOptions", () => {
  it("uses polling and ignores generated runtime directories", () => {
    expect(createDevServerWatchOptions()).toEqual({
      usePolling: true,
      interval: 500,
      ignored: ["**/.agenthub/**", "**/.agenthub-dev/**", "**/out/**", "**/node_modules/**"],
    });
  });
});
