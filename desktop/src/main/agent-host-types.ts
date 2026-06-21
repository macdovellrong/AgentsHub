import type { AgentProfile, AgentProfileLaunchMode } from "./profile-store";

export type AgentHostShellKind = AgentProfileLaunchMode;

export type AgentHostSpawnPlan = {
  command: string;
  args: string[];
};

export type AgentHostCommandMetadata = {
  command: string;
  args: string[];
};

export type AgentHostLaunchPlan = {
  host: {
    kind: AgentHostShellKind;
  };
  metadata: AgentHostCommandMetadata;
  spawn: AgentHostSpawnPlan;
};

export type BuildAgentHostLaunchPlanInput = {
  profile: AgentProfile;
  launchArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};
