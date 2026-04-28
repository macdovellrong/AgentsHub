import { describe, expect, it } from "vitest";
import { parseRoutedInput } from "./routing";
import type { AgentProfile } from "./profile-store";

const profiles: AgentProfile[] = [
  {
    id: "codex",
    name: "Codex",
    kind: "codex",
    command: "codex",
    args: [],
    aliases: ["code"],
    rolePrompt: "",
    env: {},
    defaultCwd: null,
    useWorkspaceWriteLock: true,
  },
  {
    id: "reviewer-one",
    name: "Reviewer One",
    kind: "custom",
    command: "review",
    args: [],
    aliases: ["review"],
    rolePrompt: "",
    env: {},
    defaultCwd: null,
    useWorkspaceWriteLock: false,
  },
];

describe("parseRoutedInput", () => {
  it("routes by profile id, name, or alias and strips only the prefix", () => {
    expect(parseRoutedInput("@codex implement this", profiles)).toEqual({
      targetProfileId: "codex",
      message: "implement this",
    });
    expect(parseRoutedInput("@Reviewer One check output", profiles)).toEqual({
      targetProfileId: "reviewer-one",
      message: "check output",
    });
    expect(parseRoutedInput("@review line one\nline two", profiles)).toEqual({
      targetProfileId: "reviewer-one",
      message: "line one\nline two",
    });
  });

  it("leaves messages unrouted when no known prefix is present", () => {
    expect(parseRoutedInput("hello @codex", profiles)).toEqual({
      targetProfileId: null,
      message: "hello @codex",
    });
    expect(parseRoutedInput("@unknown keep text", profiles)).toEqual({
      targetProfileId: null,
      message: "@unknown keep text",
    });
  });
});
