import { describe, expect, it } from "vitest";
import { countUtf8Bytes, subtractAckedBytes } from "./terminal-output-ack";

describe("terminal output ACK helpers", () => {
  it("counts UTF-8 bytes for terminal output", () => {
    expect(countUtf8Bytes("ready")).toBe(5);
    expect(countUtf8Bytes("中文")).toBe(6);
    expect(countUtf8Bytes("\u001b[32mok\u001b[0m")).toBe(11);
  });

  it("subtracts acknowledged bytes without going below zero", () => {
    expect(subtractAckedBytes(200, 50)).toBe(150);
    expect(subtractAckedBytes(20, 50)).toBe(0);
  });
});
