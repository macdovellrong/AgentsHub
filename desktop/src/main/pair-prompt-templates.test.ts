import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAndRenderPairPromptTemplate, pairPromptTemplatePath, renderPromptTemplate } from "./pair-prompt-templates";

let workspacePath: string | undefined;

afterEach(async () => {
  if (workspacePath) {
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = undefined;
  }
});

describe("pair prompt templates", () => {
  it("loads the built-in default without creating a workspace template", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pair-prompts-"));

    const rendered = await loadAndRenderPairPromptTemplate(workspacePath, "initial", {
      topic: "Review hook delivery",
    });

    const templatePath = pairPromptTemplatePath(workspacePath, "initial");
    await expect(readFile(templatePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(rendered).toContain("Review hook delivery");
    expect(rendered).toContain('<agenthub>{"action":"continue"');
  });

  it("ignores workspace templates and uses the built-in default", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pair-prompts-"));
    const templatePath = pairPromptTemplatePath(workspacePath, "turn");
    await mkdir(path.dirname(templatePath), { recursive: true });
    await writeFile(
      templatePath,
      "CUSTOM {{previous_profile}} reads {{brief_path}} {{memory_path}} {{previous_artifact_path}} and writes {{output_path}} with artifact_path",
      "utf8",
    );

    const rendered = await loadAndRenderPairPromptTemplate(workspacePath, "turn", {
      previous_profile: "claude",
      brief_path: ".agenthub/conversations/c1/brief.md",
      memory_path: ".agenthub/conversations/c1/memory.md",
      previous_artifact_path: ".agenthub/conversations/c1/turns/0001-claude.md",
      output_path: ".agenthub/conversations/c1/turns/0002-codex.md",
    });

    expect(rendered).not.toContain("CUSTOM");
    expect(rendered).toContain(".agenthub/conversations/c1/turns/0001-claude.md");
    expect(rendered).toContain(".agenthub/conversations/c1/turns/0002-codex.md");
  });

  it("leaves stale legacy workspace templates untouched", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-pair-prompts-"));
    const templatePath = pairPromptTemplatePath(workspacePath, "initial");
    await mkdir(path.dirname(templatePath), { recursive: true });
    await writeFile(
      templatePath,
      [
        "Topic:",
        "{{topic}}",
        '<agenthub>{"action":"continue","proposal_version":1,"summary":"short","message":"legacy body"}</agenthub>',
      ].join("\n"),
      "utf8",
    );

    const rendered = await loadAndRenderPairPromptTemplate(workspacePath, "initial", {
      topic: "Review file memory",
      brief_path: ".agenthub/conversations/c1/brief.md",
      memory_path: ".agenthub/conversations/c1/memory.md",
      output_path: ".agenthub/conversations/c1/turns/0001-claude.md",
    });

    const unchangedTemplate = await readFile(templatePath, "utf8");
    expect(unchangedTemplate).toContain('"message":"legacy body"');
    expect(rendered).toContain(".agenthub/conversations/c1/turns/0001-claude.md");
  });

  it("renders missing placeholder values as empty text", () => {
    expect(renderPromptTemplate("A {{known}} B {{missing}}", { known: "value" })).toBe("A value B ");
  });

  it("renders file-backed pair prompt variables", () => {
    const rendered = renderPromptTemplate(
      "Brief={{brief_path}}\nMemory={{memory_path}}\nPrevious={{previous_artifact_path}}\nOutput={{output_path}}",
      {
        brief_path: ".agenthub/conversations/c1/brief.md",
        memory_path: ".agenthub/conversations/c1/memory.md",
        previous_artifact_path: ".agenthub/conversations/c1/turns/0001-claude.md",
        output_path: ".agenthub/conversations/c1/turns/0002-codex.md",
      },
    );

    expect(rendered).toContain("Brief=.agenthub/conversations/c1/brief.md");
    expect(rendered).toContain("Memory=.agenthub/conversations/c1/memory.md");
    expect(rendered).toContain("Previous=.agenthub/conversations/c1/turns/0001-claude.md");
    expect(rendered).toContain("Output=.agenthub/conversations/c1/turns/0002-codex.md");
  });
});
