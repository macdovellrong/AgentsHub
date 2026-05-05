import { readFile } from "node:fs/promises";
import path from "node:path";

export type PairPromptTemplateName = "initial" | "turn" | "acceptance";

const PAIR_PROMPT_FILENAMES: Record<PairPromptTemplateName, string> = {
  initial: "pair-initial.md",
  turn: "pair-turn.md",
  acceptance: "pair-acceptance.md",
};

export type PromptTemplateValues = Record<string, string | number | boolean | null | undefined>;

export function pairPromptTemplatePath(workspacePath: string, templateName: PairPromptTemplateName): string {
  return path.join(workspacePath, ".agenthub", "prompts", PAIR_PROMPT_FILENAMES[templateName]);
}

export function defaultPairPromptTemplatePath(templateName: PairPromptTemplateName): string {
  return path.join(process.cwd(), "prompts", PAIR_PROMPT_FILENAMES[templateName]);
}

export async function loadAndRenderPairPromptTemplate(
  workspacePath: string,
  templateName: PairPromptTemplateName,
  values: PromptTemplateValues,
): Promise<string> {
  const template = await loadPairPromptTemplate(workspacePath, templateName);
  return renderPromptTemplate(template, values);
}

export async function loadPairPromptTemplate(
  _workspacePath: string,
  templateName: PairPromptTemplateName,
): Promise<string> {
  return readFile(defaultPairPromptTemplatePath(templateName), "utf8");
}

export function renderPromptTemplate(template: string, values: PromptTemplateValues): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  });
}
