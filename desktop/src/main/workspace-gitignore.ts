import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const AGENTHUB_RUNTIME_DIRECTORIES = [".agenthub", ".codex", ".claude", ".gemini"] as const;

export async function ensureWorkspaceGitIgnore(workspacePath: string): Promise<boolean> {
  const gitignorePath = path.join(workspacePath, ".gitignore");
  const current = await readOptionalText(gitignorePath);
  const next = mergeWorkspaceGitIgnore(current);
  if (next === current) {
    return false;
  }
  await writeFile(gitignorePath, next, "utf8");
  return true;
}

export function mergeWorkspaceGitIgnore(raw: string): string {
  const existingDirectories = new Set(
    raw
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => normalizeGitIgnorePattern(line))
      .filter((directory): directory is string => Boolean(directory)),
  );
  const missingEntries = AGENTHUB_RUNTIME_DIRECTORIES.filter((directory) => !existingDirectories.has(directory)).map(
    (directory) => `${directory}/`,
  );

  if (missingEntries.length === 0) {
    return raw;
  }

  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  const prefix = normalized ? `${normalized}\n` : "";
  return `${prefix}${missingEntries.join("\n")}\n`;
}

function normalizeGitIgnorePattern(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return null;
  }

  const pattern = trimmed
    .replace(/\s+#.*$/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/\*\*?$/, "")
    .replace(/\/+$/, "");
  return AGENTHUB_RUNTIME_DIRECTORIES.includes(pattern as (typeof AGENTHUB_RUNTIME_DIRECTORIES)[number])
    ? pattern
    : null;
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
