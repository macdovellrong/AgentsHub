import { describe, expect, it } from "vitest";
import { toSubmittedTerminalInput } from "./terminal-input";

describe("toSubmittedTerminalInput", () => {
  it("normalizes automatic PTY submissions to CRLF", () => {
    expect(toSubmittedTerminalInput("run task")).toBe("run task\r\n");
    expect(toSubmittedTerminalInput("run task\r")).toBe("run task\r\n");
    expect(toSubmittedTerminalInput("run task\n")).toBe("run task\r\n");
    expect(toSubmittedTerminalInput("run task\r\n")).toBe("run task\r\n");
  });
});
