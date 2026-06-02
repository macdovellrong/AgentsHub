import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export type ProjectHookInstaller = {
  install(workspacePath: string): Promise<void>;
};

export type InstallProjectAgentHooksOptions = {
  sourceHooksDir?: string;
  pythonLauncher?: string;
};

const HOOK_COMMON_SCRIPT = "agenthub_hook_common.py";
const CODEX_HOOK_SCRIPT = "agenthub_codex_stop.py";
const CLAUDE_HOOK_SCRIPT = "agenthub_claude_stop.py";
const GEMINI_HOOK_SCRIPT = "agenthub_gemini_after_agent.py";

export class ProjectAgentHookInstaller implements ProjectHookInstaller {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly options: InstallProjectAgentHooksOptions = {}) {}

  install(workspacePath: string): Promise<void> {
    const cacheKey = path.normalize(workspacePath).toLowerCase();
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const installing = installProjectAgentHooks(workspacePath, this.options).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, installing);
    return installing;
  }
}

export async function installProjectAgentHooks(
  workspacePath: string,
  options: InstallProjectAgentHooksOptions = {},
): Promise<void> {
  const sourceHooksDir = options.sourceHooksDir ?? resolveDefaultHookScriptsDirectory();
  const pythonLauncher = options.pythonLauncher ?? "py -3";

  await installCodexHooks(workspacePath, sourceHooksDir, pythonLauncher);
  await installClaudeHooks(workspacePath, sourceHooksDir, pythonLauncher);
  await installGeminiHooks(workspacePath, sourceHooksDir, pythonLauncher);
}

function resolveDefaultHookScriptsDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.AGENTHUB_HOOKS_SOURCE_DIR,
    path.resolve(process.cwd(), "scripts", "hooks"),
    path.resolve(process.cwd(), "..", "scripts", "hooks"),
    path.resolve(moduleDirectory, "../../../scripts/hooks"),
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, "scripts", "hooks") : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const found = candidates.find((candidate) => existsSync(path.join(candidate, HOOK_COMMON_SCRIPT)));
  if (!found) {
    throw new Error(`AgentHub hook scripts not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

async function installCodexHooks(workspacePath: string, sourceHooksDir: string, pythonLauncher: string): Promise<void> {
  const codexDir = path.join(workspacePath, ".codex");
  const hooksDir = path.join(codexDir, "hooks");
  await copyHookScripts(sourceHooksDir, hooksDir, CODEX_HOOK_SCRIPT);
  await updateCodexConfig(path.join(codexDir, "config.toml"));
  await updateJsonFile(path.join(codexDir, "hooks.json"), (settings) => {
    const hooks = ensureRecord(settings, "hooks");
    hooks.Stop = upsertHookGroup(toArray(hooks.Stop), CODEX_HOOK_SCRIPT, {
      hooks: [
        {
          type: "command",
          command: buildPythonCommand(pythonLauncher, path.join(hooksDir, CODEX_HOOK_SCRIPT)),
          timeout: 5,
        },
      ],
    });
    return settings;
  });
}

async function installClaudeHooks(workspacePath: string, sourceHooksDir: string, pythonLauncher: string): Promise<void> {
  const claudeDir = path.join(workspacePath, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  await copyHookScripts(sourceHooksDir, hooksDir, CLAUDE_HOOK_SCRIPT);
  await updateJsonFile(path.join(claudeDir, "settings.local.json"), (settings) => {
    const hooks = ensureRecord(settings, "hooks");
    const hookGroup = {
      hooks: [
        {
          type: "command",
          command: buildPythonCommand(pythonLauncher, path.join(hooksDir, CLAUDE_HOOK_SCRIPT)),
          timeout: 5,
        },
      ],
    };
    hooks.Stop = upsertHookGroup(toArray(hooks.Stop), CLAUDE_HOOK_SCRIPT, hookGroup);
    hooks.StopFailure = upsertHookGroup(toArray(hooks.StopFailure), CLAUDE_HOOK_SCRIPT, hookGroup);
    return settings;
  });
}

async function installGeminiHooks(workspacePath: string, sourceHooksDir: string, pythonLauncher: string): Promise<void> {
  const geminiDir = path.join(workspacePath, ".gemini");
  const hooksDir = path.join(geminiDir, "hooks");
  await copyHookScripts(sourceHooksDir, hooksDir, GEMINI_HOOK_SCRIPT);
  await updateJsonFile(path.join(geminiDir, "settings.json"), (settings) => {
    const hooks = ensureRecord(settings, "hooks");
    hooks.AfterAgent = upsertHookGroup(toArray(hooks.AfterAgent), GEMINI_HOOK_SCRIPT, {
      matcher: "*",
      hooks: [
        {
          name: "agenthub-result",
          type: "command",
          command: buildPythonCommand(pythonLauncher, path.join(hooksDir, GEMINI_HOOK_SCRIPT)),
          timeout: 5000,
        },
      ],
    });
    return settings;
  });
}

async function copyHookScripts(sourceHooksDir: string, targetHooksDir: string, entryScript: string): Promise<void> {
  await mkdir(targetHooksDir, { recursive: true });
  await Promise.all([
    copyFile(path.join(sourceHooksDir, HOOK_COMMON_SCRIPT), path.join(targetHooksDir, HOOK_COMMON_SCRIPT)),
    copyFile(path.join(sourceHooksDir, entryScript), path.join(targetHooksDir, entryScript)),
  ]);
}

async function updateCodexConfig(configPath: string): Promise<void> {
  const raw = await readOptionalText(configPath);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, ensureCodexHooksFeature(raw), "utf8");
}

function ensureCodexHooksFeature(raw: string): string {
  const text = stripBom(raw).replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return "[features]\nhooks = true\n";
  }

  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  const sectionStart = lines.findIndex((line) => line.trim() === "[features]");
  if (sectionStart < 0) {
    return `${lines.join("\n").trimEnd()}\n\n[features]\nhooks = true\n`;
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      sectionEnd = index;
      break;
    }
  }

  const featureLines = lines.slice(sectionStart + 1, sectionEnd);
  const hookLineIndex = featureLines.findIndex((line) => /^\s*hooks\s*=/.test(line));
  if (hookLineIndex >= 0) {
    lines[sectionStart + 1 + hookLineIndex] = "hooks = true";
  } else {
    lines.splice(sectionStart + 1, 0, "hooks = true");
    sectionEnd += 1;
  }

  for (let index = sectionEnd - 1; index > sectionStart; index -= 1) {
    if (/^\s*codex_hooks\s*=/.test(lines[index])) {
      lines.splice(index, 1);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function updateJsonFile(
  filePath: string,
  update: (settings: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const settings = parseJsonObject(await readOptionalText(filePath), filePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(update(settings), null, 2)}\n`, "utf8");
}

function parseJsonObject(raw: string, filePath: string): Record<string, unknown> {
  const text = stripBom(raw).trim();
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed;
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

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isRecord(existing)) {
    return existing;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function upsertHookGroup(existingGroups: unknown[], markerScriptName: string, nextGroup: Record<string, unknown>): unknown[] {
  return [
    ...existingGroups.filter((group) => !JSON.stringify(group).includes(markerScriptName)),
    nextGroup,
  ];
}

function buildPythonCommand(pythonLauncher: string, scriptPath: string): string {
  return `${pythonLauncher} ${quoteCommandArgument(scriptPath)}`;
}

function quoteCommandArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
