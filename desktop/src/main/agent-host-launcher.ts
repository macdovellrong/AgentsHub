import { existsSync } from "node:fs";
import path from "node:path";
import { defaultLaunchModeForProfileKind, type AgentProfileLaunchMode } from "./profile-store";
import type { AgentHostLaunchPlan, AgentHostSpawnPlan, BuildAgentHostLaunchPlanInput } from "./agent-host-types";

export function buildAgentHostLaunchPlan(input: BuildAgentHostLaunchPlanInput): AgentHostLaunchPlan {
  const targetCommand = resolveProfileCommand(input.profile.command, input.env);
  const launchMode = resolveLaunchMode(input.profile.launchMode, input.profile.kind);
  return {
    host: {
      kind: launchMode,
    },
    metadata: {
      command: input.profile.command,
      args: [...input.launchArgs],
    },
    spawn: buildHostSpawnPlan({
      launchMode,
      targetCommand,
      launchArgs: input.launchArgs,
      cwd: input.cwd,
      env: input.env,
    }),
  };
}

export function resolveProfileCommand(command: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path.isAbsolute(command) || command.includes("\\") || command.includes("/")) {
    return command;
  }

  const pathValue = env.PATH ?? env.Path ?? env.path;
  const hasExtension = path.extname(command).length > 0;
  const extensions =
    process.platform === "win32" && !hasExtension
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];

  for (const directory of commandSearchDirectories(pathValue, env)) {
    if (!directory) {
      continue;
    }
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return command;
}

function resolveLaunchMode(
  launchMode: AgentProfileLaunchMode | undefined,
  kind: BuildAgentHostLaunchPlanInput["profile"]["kind"],
): AgentProfileLaunchMode {
  return launchMode ?? defaultLaunchModeForProfileKind(kind);
}

function buildHostSpawnPlan(input: {
  launchMode: AgentProfileLaunchMode;
  targetCommand: string;
  launchArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): AgentHostSpawnPlan {
  if (input.launchMode === "powershell") {
    return {
      command: resolveProfileCommand("powershell.exe", input.env),
      args: buildPowerShellHostedArgs(input.targetCommand, input.launchArgs, input.cwd),
    };
  }
  if (input.launchMode === "cmd") {
    return {
      command: resolveProfileCommand("cmd.exe", input.env),
      args: buildCmdHostedArgs(input.targetCommand, input.launchArgs, input.cwd),
    };
  }
  return {
    command: input.targetCommand,
    args: [...input.launchArgs],
  };
}

function commandSearchDirectories(pathValue: string | undefined, env: NodeJS.ProcessEnv): string[] {
  const directories = pathValue ? pathValue.split(path.delimiter) : [];
  const userProfile = env.USERPROFILE ?? env.HOME;
  if (userProfile) {
    directories.push(path.join(userProfile, ".local", "bin"));
  }
  if (env.APPDATA) {
    directories.push(path.join(env.APPDATA, "npm"));
  }
  if (env.LOCALAPPDATA) {
    directories.push(path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps"));
  }
  return [...new Set(directories.filter(Boolean))];
}

function buildPowerShellHostedArgs(command: string, args: string[], cwd: string): string[] {
  const commandInvocation = [`& ${quotePowerShellString(command)}`, ...args.map(quotePowerShellString)].join(" ");
  const script = [
    "Remove-Module PSReadLine -ErrorAction SilentlyContinue",
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
    "$OutputEncoding=[System.Text.Encoding]::UTF8",
    "chcp 65001 | Out-Null",
    `Set-Location -LiteralPath ${quotePowerShellString(cwd)}`,
    commandInvocation,
  ].join("; ");

  return ["-NoLogo", "-NoProfile", "-NoExit", "-Command", script];
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildCmdHostedArgs(command: string, args: string[], cwd: string): string[] {
  const commandInvocation = [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(" ");
  return ["/K", `chcp 65001 > nul && cd /d ${quoteCmdArg(cwd)} && ${commandInvocation}`];
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
